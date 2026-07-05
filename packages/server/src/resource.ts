import { ORPCError } from "@orpc/client";
import { Builder, AnyProcedure } from "@orpc/server";
import { NoResultError } from "kysely";
import { z } from "zod/v4";

import { DialectKind } from "./migrator";
import { ColumnDef, RelationDef, TablesDef } from "./schema";

// ── Permission types ───────────────────────────────────────────────────────

/**
 * - `"public"`        — no restriction
 * - `"authenticated"` — user must be signed in
 * - `"admin"`         — user must have `role === "admin"` (requires Better Auth admin plugin)
 * - `"owner"`         — user must own the row; requires `ownerColumn`; not valid for `list`/`create`
 * - function          — custom check: `({ context, row? }) => boolean | Promise<boolean>`
 */
export type PermissionFn = (args: {
  context: { headers: Headers; auth: any; [key: string]: unknown };
  row?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

export type ResourcePermission = "public" | "authenticated" | "admin" | "owner" | PermissionFn;

export type ResourcePermissions = {
  /** `"owner"` on `list` scopes results to rows where `ownerColumn` equals the signed-in user's ID. */
  list?: ResourcePermission;
  get?: ResourcePermission;
  create?: Exclude<ResourcePermission, "owner">;
  update?: ResourcePermission;
  delete?: ResourcePermission;
};

export type ResourceOptions = {
  /**
   * Per-action permission rules. Defaults to `"public"` for all actions.
   * Use `"owner"` on `get`/`update`/`delete` to restrict to the row creator.
   */
  permissions?: ResourcePermissions;
  /**
   * Column that stores the creator's user ID.
   * Required when any permission is `"owner"`.
   * When `create` permission requires a session and `ownerColumn` is set,
   * the current user's ID is automatically injected into the insert.
   */
  ownerColumn?: string;
  /** Max rows `list` can return per call, and the default when `take` isn't passed. Defaults to 100/50. */
  listLimit?: { default?: number; max?: number };
};

/** Actions (of a given resource) whose permission requires a signed-in session — used by `Outer.build()` to fail fast if `.auth()` was never called. */
export function actionsRequiringAuth(permissions: ResourcePermissions): string[] {
  return Object.entries(permissions)
    .filter(
      ([, permission]) => permission && permission !== "public" && typeof permission !== "function",
    )
    .map(([action]) => action);
}

// ── Zod schema derivation ──────────────────────────────────────────────────

/**
 * Output values for `timestamp`/`boolean` differ by dialect (postgres drivers
 * return `Date`/`boolean`, sqlite returns ISO strings/`0`|`1`), so the output
 * schema (validated against real DB rows) must accept both instead of the
 * input-only `z.iso.datetime()` / `z.boolean()` shape.
 */
const OUTPUT_TYPE_TO_ZOD: Record<string, z.ZodType> = {
  serial: z.number().int(),
  text: z.string(),
  varchar: z.string(),
  integer: z.number().int(),
  boolean: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)),
  timestamp: z.union([z.string(), z.date()]),
  jsonb: z.unknown(),
  uuid: z.uuid(),
};

const INPUT_TYPE_TO_ZOD: Record<string, z.ZodType> = {
  serial: z.number().int(),
  text: z.string(),
  varchar: z.string(),
  integer: z.number().int(),
  boolean: z.boolean(),
  timestamp: z.iso.datetime({ offset: true }),
  jsonb: z.unknown(),
  uuid: z.uuid(),
};

function colToZod(col: ColumnDef, map: Record<string, z.ZodType>): z.ZodType {
  const base = map[col._type] ?? z.unknown();
  return col._nullable ? z.union([base, z.null()]).optional() : base;
}

/** Column types that support range operators (`lt`/`lte`/`gt`/`gte`). */
const RANGE_TYPES = new Set(["serial", "integer", "timestamp"]);
const TEXT_TYPES = new Set(["text", "varchar", "uuid"]);

/** Per-column filter object mirroring Sola's `FieldFilter` operators. */
function buildFieldFilterSchema(col: ColumnDef): z.ZodType {
  const base = INPUT_TYPE_TO_ZOD[col._type] ?? z.unknown();
  const shape: Record<string, z.ZodType> = {
    equals: base,
    not: base,
    in: z.array(base),
    notIn: z.array(base),
    isNull: z.boolean(),
  };
  if (RANGE_TYPES.has(col._type)) {
    shape["lt"] = base;
    shape["lte"] = base;
    shape["gt"] = base;
    shape["gte"] = base;
  }
  if (TEXT_TYPES.has(col._type)) {
    shape["contains"] = z.string();
    shape["startsWith"] = z.string();
    shape["endsWith"] = z.string();
  }
  return z.object(shape).partial();
}

/** Recursive `where` schema (per-column value/filter plus `AND`/`OR`/`NOT`) validating Sola's `WhereClause`. */
function buildFilterSchema(cols: Record<string, ColumnDef>): z.ZodType {
  const fieldShape: Record<string, z.ZodType> = {};
  for (const [name, col] of Object.entries(cols)) {
    const base = INPUT_TYPE_TO_ZOD[col._type] ?? z.unknown();
    fieldShape[name] = z.union([base, z.null(), buildFieldFilterSchema(col)]).optional();
  }
  const filterSchema: z.ZodType = z.lazy(() =>
    z.object({
      ...fieldShape,
      AND: z.array(filterSchema).optional(),
      OR: z.array(filterSchema).optional(),
      NOT: filterSchema.optional(),
    }),
  );
  return filterSchema;
}

function buildOrderBySchema(cols: Record<string, ColumnDef>): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const name of Object.keys(cols)) shape[name] = z.enum(["asc", "desc"]).optional();
  return z.array(z.object(shape)).min(1);
}

/**
 * `include` input (`{ relatedTable: true }`) and the matching optional output
 * fields, derived from the schema's relations originating at this table.
 */
function buildIncludeSchemas(
  relations: RelationDef[],
  tables: TablesDef,
): { includeSchema: z.ZodType | null; relationOutputShape: Record<string, z.ZodType> } {
  const includeShape: Record<string, z.ZodType> = {};
  const relationOutputShape: Record<string, z.ZodType> = {};
  for (const rel of relations) {
    const relCols = tables[rel.toTable];
    if (!relCols) continue;
    includeShape[rel.toTable] = z.boolean().optional();
    const relRowShape: Record<string, z.ZodType> = {};
    for (const [name, col] of Object.entries(relCols)) {
      relRowShape[name] = colToZod(col, OUTPUT_TYPE_TO_ZOD);
    }
    const relRow = z.object(relRowShape);
    const isArray = rel.kind === "hasMany" || rel.kind === "manyToMany";
    relationOutputShape[rel.toTable] = (
      isArray ? z.array(relRow) : z.union([relRow, z.null()])
    ).optional();
  }
  const hasRelations = Object.keys(includeShape).length > 0;
  return {
    // strict so a typo'd relation name is a 400 instead of being silently ignored
    includeSchema: hasRelations ? z.strictObject(includeShape) : null,
    relationOutputShape,
  };
}

function buildSchemas({
  cols,
  ownerColumn,
}: {
  cols: Record<string, ColumnDef>;
  ownerColumn?: string;
}) {
  const entries = Object.entries(cols);

  const rowShape: Record<string, z.ZodType> = {};
  for (const [name, col] of entries) {
    rowShape[name] = colToZod(col, OUTPUT_TYPE_TO_ZOD);
  }
  const rowSchema = z.object(rowShape);

  const pkEntry = entries.find(([, col]) => col._primaryKey);
  const pkName = pkEntry?.[0] ?? "id";
  const pkZod = pkEntry
    ? colToZod(pkEntry[1], INPUT_TYPE_TO_ZOD)
    : z.union([z.string(), z.number()]);
  const whereSchema = z.object({ [pkName]: pkZod });

  // Omit: serial PK (db-generated), columns with defaults, ownerColumn (auto-filled on create)
  const createShape: Record<string, z.ZodType> = {};
  for (const [name, col] of entries) {
    if (col._type === "serial" && col._primaryKey) continue;
    if (col._default !== null) continue;
    if (ownerColumn && name === ownerColumn) continue;
    createShape[name] = colToZod(col, INPUT_TYPE_TO_ZOD);
  }
  const createSchema = z.object(createShape);

  return { rowSchema, createSchema, updateSchema: createSchema.partial(), whereSchema, pkName };
}

// ── Permission enforcement ─────────────────────────────────────────────────

async function getSession(context: any) {
  if (!context.auth) {
    throw new Error(
      "This resource permission requires auth — call `.auth()` on the Outer instance before `.build()`",
    );
  }
  const result = await context.auth.api.getSession({ headers: context.headers });
  if (!result?.session || !result?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "You must be signed in" });
  }
  return result.user as { id: string; role?: string; [key: string]: unknown };
}

/**
 * Enforces a permission rule. Returns the session user when a session was
 * required (useful for auto-filling ownerColumn), or null for public access.
 */
async function enforce(
  permission: ResourcePermission | undefined,
  context: any,
  row?: Record<string, unknown>,
  ownerColumn?: string,
): Promise<{ id: string; [key: string]: unknown } | null> {
  if (!permission || permission === "public") return null;

  if (typeof permission === "function") {
    const allowed = await permission({ context, ...(row !== undefined && { row }) });
    if (!allowed) throw new ORPCError("FORBIDDEN", { message: "Permission denied" });
    return null;
  }

  const user = await getSession(context);

  if (permission === "admin" && user.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }

  if (permission === "owner") {
    if (!ownerColumn) throw new Error("ownerColumn is required when using 'owner' permission");
    if (!row || row[ownerColumn] !== user.id) {
      throw new ORPCError("FORBIDDEN", { message: "You do not own this resource" });
    }
  }

  return user;
}

// ── DB error mapping ────────────────────────────────────────────────────────

type ConstraintMapping = { code: "CONFLICT" | "BAD_REQUEST"; message: string };

/** Postgres SQLSTATE class 23 (integrity constraint violation) codes we recognize. */
const PG_CONSTRAINT_CODES: Record<string, ConstraintMapping> = {
  "23505": { code: "CONFLICT", message: "A record with this value already exists" },
  "23503": { code: "CONFLICT", message: "This action conflicts with a related record" },
  "23502": { code: "BAD_REQUEST", message: "Missing a required field" },
  "23514": { code: "BAD_REQUEST", message: "Value does not satisfy a constraint" },
};

/** SQLite's `sqlite3_errstr` extended result codes (`.code` on the driver's thrown error). */
const SQLITE_CONSTRAINT_CODES: Record<string, ConstraintMapping> = {
  SQLITE_CONSTRAINT_UNIQUE: {
    code: "CONFLICT",
    message: "A record with this value already exists",
  },
  SQLITE_CONSTRAINT_PRIMARYKEY: {
    code: "CONFLICT",
    message: "A record with this value already exists",
  },
  SQLITE_CONSTRAINT_FOREIGNKEY: {
    code: "CONFLICT",
    message: "This action conflicts with a related record",
  },
  SQLITE_CONSTRAINT_NOTNULL: { code: "BAD_REQUEST", message: "Missing a required field" },
  SQLITE_CONSTRAINT_CHECK: { code: "BAD_REQUEST", message: "Value does not satisfy a constraint" },
};

const CONSTRAINT_CODES_BY_KIND: Record<DialectKind, Record<string, ConstraintMapping>> = {
  postgres: PG_CONSTRAINT_CODES,
  sqlite: SQLITE_CONSTRAINT_CODES,
};

/**
 * Maps low-level DB/Kysely errors to clean `ORPCError`s so clients get proper
 * status codes (404/409/400) instead of an opaque 500. Anything unrecognized
 * is rethrown as-is — oRPC already sanitizes uncaught errors to a generic
 * "Internal Server Error" before they reach the client, so nothing leaks.
 */
function mapDbError(error: unknown, kind: DialectKind): never {
  if (error instanceof NoResultError) {
    throw new ORPCError("NOT_FOUND", { message: "Record not found", cause: error });
  }
  const dbCode = (error as { code?: unknown } | null)?.code;
  const constraintCodes = CONSTRAINT_CODES_BY_KIND[kind];
  if (typeof dbCode === "string" && dbCode in constraintCodes) {
    const mapped = constraintCodes[dbCode]!;
    throw new ORPCError(mapped.code, { message: mapped.message, cause: error });
  }
  throw error;
}

/** Fetches the row when the permission needs it (owner check or custom fn). */
async function fetchForPermission(
  permission: ResourcePermission | undefined,
  db: any,
  tableName: string,
  pkName: string,
  pkValue: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (permission === "owner" || typeof permission === "function") {
    return db.query[tableName].findFirst({ where: { [pkName]: pkValue } }) ?? undefined;
  }
  return undefined;
}

// ── Procedure builder ──────────────────────────────────────────────────────

export function buildResourceProcedures(
  tableName: string,
  cols: Record<string, ColumnDef>,
  base: Builder<any, any>,
  options: ResourceOptions = {},
  kind: DialectKind = "postgres",
  schemaInfo: { tables: TablesDef; relations: RelationDef[] } = { tables: {}, relations: [] },
): Record<string, AnyProcedure> {
  const { permissions = {}, ownerColumn, listLimit } = options;
  const usesOwnerPermission = Object.values(permissions).some((p) => p === "owner");
  if (usesOwnerPermission && !ownerColumn) {
    throw new Error(
      `resource("${tableName}"): "owner" permission requires \`ownerColumn\` to be set in ResourceOptions`,
    );
  }

  const { rowSchema, createSchema, updateSchema, whereSchema, pkName } = buildSchemas({
    cols,
    ...(ownerColumn !== undefined && { ownerColumn }),
  });

  const tableRelations = schemaInfo.relations.filter((r) => r.fromTable === tableName);
  const filterSchema = buildFilterSchema(cols);
  const orderBySchema = buildOrderBySchema(cols);
  const { includeSchema, relationOutputShape } = buildIncludeSchemas(
    tableRelations,
    schemaInfo.tables,
  );
  // Row shape that tolerates included relations in the output
  const rowWithRelations =
    Object.keys(relationOutputShape).length > 0 ? rowSchema.extend(relationOutputShape) : rowSchema;

  const defaultLimit = listLimit?.default ?? 50;
  const maxLimit = listLimit?.max ?? 100;

  const list = base
    .input(
      z
        .object({
          where: filterSchema.optional(),
          orderBy: orderBySchema.optional(),
          take: z.number().int().positive().max(maxLimit).optional(),
          skip: z.number().int().nonnegative().optional(),
          ...(includeSchema && { include: includeSchema.optional() }),
        })
        .optional(),
    )
    .output(z.array(rowWithRelations))
    .handler(async ({ context, input }: any) => {
      let where = input?.where;
      if (permissions.list === "owner") {
        // Owner-scoped list: restrict to the signed-in user's rows
        const user = await getSession(context);
        where = { AND: [...(where ? [where] : []), { [ownerColumn!]: user.id }] };
      } else {
        await enforce(permissions.list, context);
      }
      return context.db.query[tableName].findMany({
        ...(where && { where }),
        ...(input?.orderBy && { orderBy: input.orderBy }),
        ...(input?.skip !== undefined && { skip: input.skip }),
        ...(input?.include && { include: input.include }),
        take: input?.take ?? defaultLimit,
      });
    });

  const get = base
    .input(
      includeSchema
        ? (whereSchema as z.ZodObject).extend({ include: includeSchema.optional() })
        : whereSchema,
    )
    .output(rowWithRelations.nullable())
    .handler(async ({ context, input }: any) => {
      const row = await context.db.query[tableName].findFirst({
        where: { [pkName]: input[pkName] },
        ...(input.include && { include: input.include }),
      });
      await enforce(permissions.get, context, row ?? undefined, ownerColumn);
      return row ?? null;
    });

  const create = base
    .input(createSchema)
    .output(rowSchema)
    .handler(async ({ context, input }: any) => {
      const user = await enforce(permissions.create, context);
      const values: Record<string, unknown> = { ...input };
      if (ownerColumn && user) values[ownerColumn] = user.id;
      try {
        return await context.db
          .insertInto(tableName)
          .values(values)
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  const createMany = base
    .input(z.object({ data: z.array(createSchema).min(1).max(1000) }))
    .output(z.array(rowSchema))
    .handler(async ({ context, input }: any) => {
      const user = await enforce(permissions.create, context);
      const rows = input.data.map((values: Record<string, unknown>) =>
        ownerColumn && user ? { ...values, [ownerColumn]: user.id } : values,
      );
      try {
        return await context.db.insertInto(tableName).values(rows).returningAll().execute();
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  const update = base
    .input(z.object({ where: whereSchema, data: updateSchema }))
    .output(rowSchema)
    .handler(async ({ context, input }: any) => {
      const row = await fetchForPermission(
        permissions.update,
        context.db,
        tableName,
        pkName,
        input.where[pkName],
      );
      await enforce(permissions.update, context, row, ownerColumn);
      if (Object.keys(input.data).length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "update requires at least one field in `data`",
        });
      }
      try {
        return await context.db
          .updateTable(tableName)
          .set(input.data)
          .where(pkName as any, "=", input.where[pkName])
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  const del = base
    .input(whereSchema)
    .output(rowSchema)
    .handler(async ({ context, input }: any) => {
      const row = await fetchForPermission(
        permissions.delete,
        context.db,
        tableName,
        pkName,
        input[pkName],
      );
      await enforce(permissions.delete, context, row, ownerColumn);
      try {
        return await context.db
          .deleteFrom(tableName)
          .where(pkName as any, "=", input[pkName])
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  return { list, get, create, createMany, update, delete: del };
}

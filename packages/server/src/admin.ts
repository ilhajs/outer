import { ORPCError } from "@orpc/client";
import { AnyProcedure, Builder } from "@orpc/server";
import { z } from "zod/v4";

import { DialectKind } from "./migrator";
import { getSession, hasRole, mapDbError, TypedProcedure } from "./resource";
import { ColumnDef, RelationDef, SchemaResult } from "./schema";

// ── Config ──────────────────────────────────────────────────────────────────

export type AdminConfig = {
  /** Max rows `_admin.data.list` can return per call, and the default when `take` isn't passed. Defaults to 200/50. */
  listLimit?: { default?: number; max?: number };
  /** Roles granted admin access. Match Better Auth's admin plugin `adminRoles` if you customize it. Defaults to `["admin"]`. */
  roles?: string[];
};

// ── Output shapes ───────────────────────────────────────────────────────────

export type AdminColumnMeta = {
  name: string;
  type: ColumnDef["_type"];
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  hasDefault: boolean;
  default: string | null;
  references: { table: string; column: string } | null;
};

export type AdminMeta = {
  name: string;
  dialect: DialectKind;
  /** All registered schema versions, in registration order. */
  versions: string[];
  /** The latest schema version — `null` when no `.schema()` was called. */
  version: string | null;
  /** Whether `GET /openapi.json` is mounted — i.e. `.openapi()` was enabled. */
  openapi: boolean;
  tables: { name: string; columns: AdminColumnMeta[] }[];
  relations: RelationDef[];
};

export type AdminMigrationStatus = {
  name: string;
  /** ISO timestamp when the migration was executed, or `null` if pending. */
  executedAt: string | null;
};

type Row = Record<string, unknown>;

/**
 * The procedures `.admin()` registers under the reserved `_admin` namespace.
 * Rows are untyped (`Record<string, unknown>`) because the target table is a
 * runtime input — the UI is expected to drive itself from `_admin.meta`.
 */
export type AdminRouter = {
  meta: TypedProcedure<unknown, AdminMeta>;
  migrations: TypedProcedure<unknown, AdminMigrationStatus[]>;
  data: {
    list: TypedProcedure<
      {
        table: string;
        where?: Row;
        orderBy?: Record<string, "asc" | "desc">[];
        take?: number;
        skip?: number;
      },
      { data: Row[]; count: number }
    >;
    get: TypedProcedure<{ table: string; where: Row }, Row | null>;
    create: TypedProcedure<{ table: string; data: Row }, Row>;
    update: TypedProcedure<{ table: string; where: Row; data: Row }, Row[]>;
    delete: TypedProcedure<{ table: string; where: Row }, Row[]>;
  };
};

/**
 * Router shape containing only the `_admin.*` procedures, as mounted by
 * `.admin()`. Pass it to a client factory to build a type-safe admin-only
 * client for any Outer instance without importing the app's server code:
 *
 * ```ts
 * import { createClient } from "@outerjs/sdk";
 * import type { OuterAdminRouter } from "@outerjs/server";
 *
 * const client = createClient<OuterAdminRouter>({ baseUrl }).auth().build();
 * const meta = await client._admin.meta();       // AdminMeta
 * const rows = await client._admin.data.list({ table: "post", take: 20 });
 * ```
 */
export type OuterAdminRouter = { _admin: AdminRouter };

// ── Guard ───────────────────────────────────────────────────────────────────

/** Every admin procedure requires a signed-in session with an admin role — same semantics as the `"admin"` resource permission. */
function makeRequireAdmin(adminRoles: string[]) {
  return async function requireAdmin(context: any) {
    const user = await getSession(context);
    if (!hasRole(user, adminRoles)) {
      throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
    }
    return user;
  };
}

// ── Input validation ────────────────────────────────────────────────────────
// The target table/columns are runtime inputs, so zod can only validate the
// envelope — column names (SQL identifiers) are checked against the schema
// here, while values stay parameterized by Kysely/Sola.

const FILTER_OPERATORS = new Set([
  "equals",
  "not",
  "in",
  "notIn",
  "isNull",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "endsWith",
]);

function badRequest(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}

function assertColumnKeys(
  keys: string[],
  cols: Record<string, ColumnDef>,
  table: string,
  what: string,
): void {
  for (const key of keys) {
    if (!(key in cols)) badRequest(`Unknown column "${key}" in ${what} for table "${table}"`);
  }
}

/** Recursively validates a Sola-style `where` filter: column keys must exist, operator keys must be recognized. */
function assertWhere(where: Row, cols: Record<string, ColumnDef>, table: string): void {
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" || key === "OR") {
      if (!Array.isArray(value)) badRequest(`"${key}" must be an array of filters`);
      for (const nested of value) assertWhere(nested as Row, cols, table);
    } else if (key === "NOT") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        badRequest(`"NOT" must be a filter object`);
      }
      assertWhere(value as Row, cols, table);
    } else {
      if (!(key in cols)) badRequest(`Unknown column "${key}" in where for table "${table}"`);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        for (const op of Object.keys(value)) {
          if (!FILTER_OPERATORS.has(op)) {
            badRequest(`Unknown filter operator "${op}" on column "${key}"`);
          }
        }
      }
    }
  }
}

/** `where` for write actions is plain column equality — reject operator objects so a filter can't silently widen an update/delete. */
function assertEqualityWhere(where: Row, cols: Record<string, ColumnDef>, table: string): void {
  const entries = Object.entries(where);
  if (entries.length === 0) badRequest("`where` requires at least one column");
  assertColumnKeys(
    entries.map(([k]) => k),
    cols,
    table,
    "where",
  );
  for (const [key, value] of entries) {
    if (value !== null && typeof value === "object") {
      badRequest(`\`where.${key}\` must be a plain value (operators are not allowed on writes)`);
    }
  }
}

// ── Procedure builder ───────────────────────────────────────────────────────

/**
 * Builds the `_admin.*` procedures. Called from `Outer.build()` (not from
 * `.admin()` itself) so the latest schema and the migrator are available.
 * Returns procedures keyed by dot-name relative to the `_admin` namespace.
 */
export function buildAdminProcedures(params: {
  base: Builder<any, any>;
  name: string | undefined;
  schemas: SchemaResult<any>[];
  kind: DialectKind;
  migrator: { getMigrations(): Promise<readonly { name: string; executedAt?: Date }[]> };
  /** Mirrors `.openapi()` — surfaced in `meta` so UIs can hide API-reference views. */
  openapi: boolean;
  config: AdminConfig;
}): Record<string, AnyProcedure> {
  const { base, name, schemas, kind, migrator, openapi, config } = params;
  const latest = schemas.at(-1);
  const tables = (latest?.tables ?? {}) as Record<string, Record<string, ColumnDef>>;
  const relations = latest?.relations ?? [];

  const tableCols = (table: string): Record<string, ColumnDef> => {
    const cols = tables[table];
    if (!cols) badRequest(`Unknown table "${table}"`);
    return cols;
  };

  const defaultTake = config.listLimit?.default ?? 50;
  const maxTake = config.listLimit?.max ?? 200;
  const requireAdmin = makeRequireAdmin(config.roles ?? ["admin"]);

  const tableSchema = z.string().min(1);
  const rowInputSchema = z.record(z.string(), z.unknown());

  const meta = base.handler(async ({ context }: any): Promise<AdminMeta> => {
    await requireAdmin(context);
    return {
      name: name ?? "Outer API",
      dialect: kind,
      versions: schemas.map((s) => s.version),
      version: latest?.version ?? null,
      openapi,
      tables: Object.entries(tables).map(([tableName, cols]) => ({
        name: tableName,
        columns: Object.entries(cols).map(([colName, col]) => ({
          name: colName,
          type: col._type,
          nullable: col._nullable,
          primaryKey: col._primaryKey,
          unique: col._unique,
          hasDefault: col._default !== null,
          default: col._default,
          references: col._references,
        })),
      })),
      relations,
    };
  });

  const migrations = base.handler(async ({ context }: any): Promise<AdminMigrationStatus[]> => {
    await requireAdmin(context);
    const infos = await migrator.getMigrations();
    return infos.map(({ name: migrationName, executedAt }) => ({
      name: migrationName,
      executedAt: executedAt ? new Date(executedAt).toISOString() : null,
    }));
  });

  const list = base
    .input(
      z.object({
        table: tableSchema,
        where: rowInputSchema.optional(),
        orderBy: z
          .array(z.record(z.string(), z.enum(["asc", "desc"])))
          .min(1)
          .optional(),
        take: z.number().int().positive().max(maxTake).optional(),
        skip: z.number().int().nonnegative().optional(),
      }),
    )
    .handler(async ({ context, input }: any) => {
      await requireAdmin(context);
      const cols = tableCols(input.table);
      if (input.where) assertWhere(input.where, cols, input.table);
      for (const entry of input.orderBy ?? []) {
        assertColumnKeys(Object.keys(entry), cols, input.table, "orderBy");
      }
      const query = context.db.query[input.table];
      const [data, count] = await Promise.all([
        query.findMany({
          ...(input.where && { where: input.where }),
          ...(input.orderBy && { orderBy: input.orderBy }),
          ...(input.skip !== undefined && { skip: input.skip }),
          take: input.take ?? defaultTake,
        }),
        query.count({ ...(input.where && { where: input.where }) }),
      ]);
      return { data, count };
    });

  const get = base
    .input(z.object({ table: tableSchema, where: rowInputSchema }))
    .handler(async ({ context, input }: any) => {
      await requireAdmin(context);
      const cols = tableCols(input.table);
      assertWhere(input.where, cols, input.table);
      const row = await context.db.query[input.table].findFirst({ where: input.where });
      return row ?? null;
    });

  const create = base
    .input(z.object({ table: tableSchema, data: rowInputSchema }))
    .handler(async ({ context, input }: any) => {
      await requireAdmin(context);
      const cols = tableCols(input.table);
      const keys = Object.keys(input.data);
      if (keys.length === 0) badRequest("create requires at least one field in `data`");
      assertColumnKeys(keys, cols, input.table, "data");
      try {
        return await context.db
          .insertInto(input.table)
          .values(input.data)
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  const update = base
    .input(z.object({ table: tableSchema, where: rowInputSchema, data: rowInputSchema }))
    .handler(async ({ context, input }: any) => {
      await requireAdmin(context);
      const cols = tableCols(input.table);
      assertEqualityWhere(input.where, cols, input.table);
      if (Object.keys(input.data).length === 0) {
        badRequest("update requires at least one field in `data`");
      }
      assertColumnKeys(Object.keys(input.data), cols, input.table, "data");
      const data: Row = { ...input.data };
      // Touch updatedAt (when the table has one) unless the caller set it explicitly
      if (cols["updatedAt"]?._type === "timestamp" && data["updatedAt"] === undefined) {
        data["updatedAt"] = kind === "sqlite" ? new Date().toISOString() : new Date();
      }
      let query = context.db.updateTable(input.table).set(data);
      for (const [key, value] of Object.entries(input.where)) {
        query = value === null ? query.where(key, "is", null) : query.where(key, "=", value);
      }
      try {
        const rows = await query.returningAll().execute();
        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", { message: "No matching records" });
        }
        return rows;
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  const del = base
    .input(z.object({ table: tableSchema, where: rowInputSchema }))
    .handler(async ({ context, input }: any) => {
      await requireAdmin(context);
      const cols = tableCols(input.table);
      assertEqualityWhere(input.where, cols, input.table);
      let query = context.db.deleteFrom(input.table);
      for (const [key, value] of Object.entries(input.where)) {
        query = value === null ? query.where(key, "is", null) : query.where(key, "=", value);
      }
      try {
        const rows = await query.returningAll().execute();
        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", { message: "No matching records" });
        }
        return rows;
      } catch (error) {
        mapDbError(error, kind);
      }
    });

  return {
    meta,
    migrations,
    "data.list": list,
    "data.get": get,
    "data.create": create,
    "data.update": update,
    "data.delete": del,
  };
}

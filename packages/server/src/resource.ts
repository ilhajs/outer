import { ORPCError } from "@orpc/client";
import { Builder, AnyProcedure } from "@orpc/server";
import { z } from "zod/v4";

import { ColumnDef } from "./schema";

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
  list?: Exclude<ResourcePermission, "owner">;
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
};

// ── Zod schema derivation ──────────────────────────────────────────────────

const SQL_TYPE_TO_ZOD: Record<string, z.ZodType> = {
  serial: z.number().int(),
  text: z.string(),
  varchar: z.string(),
  integer: z.number().int(),
  boolean: z.boolean(),
  timestamp: z.iso.datetime({ offset: true }),
  jsonb: z.unknown(),
  uuid: z.uuid(),
};

function colToZod(col: ColumnDef): z.ZodType {
  const base = SQL_TYPE_TO_ZOD[col._type] ?? z.unknown();
  return col._nullable ? z.union([base, z.null()]).optional() : base;
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
    rowShape[name] = colToZod(col);
  }
  const rowSchema = z.object(rowShape);

  const pkEntry = entries.find(([, col]) => col._primaryKey);
  const pkName = pkEntry?.[0] ?? "id";
  const pkZod = pkEntry ? colToZod(pkEntry[1]) : z.union([z.string(), z.number()]);
  const whereSchema = z.object({ [pkName]: pkZod });

  // Omit: serial PK (db-generated), columns with defaults, ownerColumn (auto-filled on create)
  const createShape: Record<string, z.ZodType> = {};
  for (const [name, col] of entries) {
    if (col._type === "serial" && col._primaryKey) continue;
    if (col._default !== null) continue;
    if (ownerColumn && name === ownerColumn) continue;
    createShape[name] = colToZod(col);
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
): Record<string, AnyProcedure> {
  const { permissions = {}, ownerColumn } = options;
  const { rowSchema, createSchema, updateSchema, whereSchema, pkName } = buildSchemas({
    cols,
    ...(ownerColumn !== undefined && { ownerColumn }),
  });

  const list = base.output(z.array(rowSchema)).handler(async ({ context }: any) => {
    await enforce(permissions.list, context);
    return context.db.query[tableName].findMany();
  });

  const get = base
    .input(whereSchema)
    .output(rowSchema.nullable())
    .handler(async ({ context, input }: any) => {
      const row = await fetchForPermission(
        permissions.get,
        context.db,
        tableName,
        pkName,
        input[pkName],
      );
      await enforce(permissions.get, context, row, ownerColumn);
      // If not pre-fetched, fetch now (permission was public/authenticated/admin)
      return (
        row ??
        (await context.db.query[tableName].findFirst({ where: { [pkName]: input[pkName] } })) ??
        null
      );
    });

  const create = base
    .input(createSchema)
    .output(rowSchema)
    .handler(async ({ context, input }: any) => {
      const user = await enforce(permissions.create, context);
      const values: Record<string, unknown> = { ...input };
      if (ownerColumn && user) values[ownerColumn] = user.id;
      return context.db
        .insertInto(tableName)
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();
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
      return context.db
        .updateTable(tableName)
        .set(input.data)
        .where(pkName as any, "=", input.where[pkName])
        .returningAll()
        .executeTakeFirstOrThrow();
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
      return context.db
        .deleteFrom(tableName)
        .where(pkName as any, "=", input[pkName])
        .returningAll()
        .executeTakeFirstOrThrow();
    });

  return { list, get, create, update, delete: del };
}

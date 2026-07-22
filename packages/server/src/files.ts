import { ORPCError } from "@orpc/client";
import { AnyProcedure, Builder } from "@orpc/server";
import { z } from "zod/v4";

import { DialectKind } from "./migrator";
import { hasRole, mapDbError, TypedProcedure } from "./resource";
import type { OuterStorage } from "./storage";

// ── Config ──────────────────────────────────────────────────────────────────

/** Who may upload, read, and delete files. `"owner"` restricts reads/deletes to `file.userId`. */
export type FilePermission = "public" | "authenticated" | "owner" | "admin";

export type FilesConfig = {
  /**
   * Where the bytes go. Defaults to the `storage` passed to `new Outer({ storage })`;
   * required if that wasn't set.
   */
  storage?: OuterStorage;
  /** Rejects larger uploads with `PAYLOAD_TOO_LARGE`. Defaults to 10 MB. */
  maxBytes?: number;
  /** Only these MIME types may be uploaded. Entries may end in `/*` (e.g. `"image/*"`). Defaults to allowing all. */
  accept?: string[];
  /**
   * Who may do what. Defaults to upload/list `"authenticated"` and get/delete `"owner"`,
   * which is the safe default — files are private to whoever uploaded them.
   */
  permissions?: {
    upload?: Exclude<FilePermission, "owner">;
    list?: Exclude<FilePermission, "owner">;
    get?: FilePermission;
    delete?: FilePermission;
  };
  /** Path the download route is mounted at. `:id` is required. Defaults to `/files/:id`. */
  path?: string;
  /** Roles treated as admin for `"admin"` permissions. Defaults to `["admin"]`. */
  roles?: string[];
};

// ── Output shapes ───────────────────────────────────────────────────────────

export type FileRecord = {
  id: string;
  key: string;
  name: string;
  type: string;
  size: number;
  userId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Path the bytes can be fetched from — the `.files({ path })` route. */
  url: string;
};

/** The procedures `.files()` registers under the `file` namespace. */
export type FilesRouter = {
  upload: TypedProcedure<
    { file: File; name?: string; attach?: { table: string; id: string; role?: string } },
    FileRecord
  >;
  list: TypedProcedure<
    { attachedTo?: { table: string; id: string }; take?: number; skip?: number } | undefined,
    FileRecord[]
  >;
  get: TypedProcedure<{ id: string }, FileRecord | null>;
  delete: TypedProcedure<{ id: string }, { id: string }>;
  attach: TypedProcedure<
    { id: string; table: string; entityId: string; role?: string; position?: number },
    { id: string }
  >;
  detach: TypedProcedure<{ id: string; table: string; entityId: string }, { id: string }>;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS = {
  upload: "authenticated",
  list: "authenticated",
  get: "owner",
  delete: "owner",
} as const;

/**
 * Enforces a file permission against the request context. `context.user` is
 * resolved once per request by `.auth()`, so this never re-queries the session.
 * Returns the user when one was required, `null` for public access.
 */
function enforce(
  permission: FilePermission,
  context: any,
  roles: string[],
  row?: { userId?: string | null },
): { id: string } | null {
  if (permission === "public") return null;

  const user = context.user;
  if (!user) throw new ORPCError("UNAUTHORIZED", { message: "You must be signed in" });

  if (permission === "admin" && !hasRole(user, roles)) {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }
  // Admins bypass ownership so moderation tools work without a second code path
  if (permission === "owner" && !hasRole(user, roles)) {
    if (!row || row.userId !== user.id) {
      throw new ORPCError("FORBIDDEN", { message: "You do not own this file" });
    }
  }
  return user;
}

function assertAccepted(type: string, accept: string[] | undefined): void {
  if (!accept?.length) return;
  const ok = accept.some((pattern) =>
    pattern.endsWith("/*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type,
  );
  if (!ok) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File type "${type}" is not allowed. Accepted: ${accept.join(", ")}`,
    });
  }
}

/** `/files/:id` → `/files/abc`. Kept in one place so procedure output and the route agree. */
export function fileUrl(path: string, id: string): string {
  return path.replace(":id", encodeURIComponent(id));
}

function toRecord(row: any, path: string): FileRecord {
  return { ...row, url: fileUrl(path, row.id) };
}

/** Pivot table name for an attachment, matching `schema().files({ attachTo })`. */
function pivotOf(table: string): string {
  return `${table}_file`;
}

/**
 * Every pivot created by `schema().files({ attachTo })`, identified by shape
 * rather than name alone so an unrelated user table called `x_file` is left be.
 */
function pivotTables(tables: Record<string, unknown>): string[] {
  return Object.keys(tables).filter((name) => {
    if (!name.endsWith("_file")) return false;
    const cols = tables[name] as Record<string, unknown> | undefined;
    return !!cols && "fileId" in cols && "entityId" in cols;
  });
}

function assertAttachable(table: string, tables: Record<string, unknown>): string {
  const pivot = pivotOf(table);
  if (!(pivot in tables)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `"${table}" is not attachable — add it to \`schema().files({ attachTo: ["${table}"] })\`.`,
    });
  }
  return pivot;
}

// ── Procedure builder ───────────────────────────────────────────────────────

/**
 * Builds the `file.*` procedures. Called from `Outer.build()` so the latest
 * schema is available for attachment validation.
 */
export function buildFileProcedures(params: {
  base: Builder<any, any>;
  storage: OuterStorage;
  config: FilesConfig;
  tables: Record<string, unknown>;
  owned: boolean;
  kind: DialectKind;
}): Record<string, AnyProcedure> {
  const { base, storage, config, tables, owned, kind } = params;
  const maxBytes = config.maxBytes ?? 10 * 1024 * 1024;
  const path = config.path ?? "/files/:id";
  const roles = config.roles ?? ["admin"];
  const perms = { ...DEFAULT_PERMISSIONS, ...config.permissions };
  const pivots = pivotTables(tables);

  const attachInput = z.object({ table: z.string(), id: z.string(), role: z.string().optional() });

  const upload = base
    .input(
      z.object({
        file: z.file(),
        /** Overrides the browser-supplied filename. */
        name: z.string().optional(),
        attach: attachInput.optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const user = enforce(perms.upload, context, roles);
      if (input.file.size > maxBytes) {
        throw new ORPCError("PAYLOAD_TOO_LARGE", {
          message: `File is ${input.file.size} bytes; the limit is ${maxBytes}.`,
        });
      }
      const type = input.file.type || "application/octet-stream";
      assertAccepted(type, config.accept);

      const id = crypto.randomUUID();
      const key = user ? `${user.id}/${id}` : id;
      const bytes = new Uint8Array(await input.file.arrayBuffer());

      let row: any;
      try {
        row = await context.db.transaction().execute(async (trx: any) => {
          const inserted = await trx
            .insertInto("file")
            .values({
              id,
              key,
              name: input.name ?? input.file.name,
              type,
              size: input.file.size,
              ...(owned && { userId: user?.id ?? null }),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          if (input.attach) {
            const pivot = assertAttachable(input.attach.table, tables);
            await trx
              .insertInto(pivot)
              .values({
                id: crypto.randomUUID(),
                fileId: id,
                entityId: input.attach.id,
                role: input.attach.role ?? null,
              })
              .execute();
          }
          return inserted;
        });
      } catch (error) {
        throw mapDbError(error, kind);
      }

      // Written only after the row commits, so a failed insert can't orphan bytes
      await storage.set(key, bytes);
      return toRecord(row, path);
    });

  const list = base
    .input(
      z
        .object({
          attachedTo: z.object({ table: z.string(), id: z.string() }).optional(),
          take: z.number().int().min(1).max(200).optional(),
          skip: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const user = enforce(perms.list, context, roles);
      let query = context.db.selectFrom("file").selectAll("file");

      if (input?.attachedTo) {
        const pivot = assertAttachable(input.attachedTo.table, tables);
        query = query
          .innerJoin(pivot, `${pivot}.fileId`, "file.id")
          .where(`${pivot}.entityId`, "=", input.attachedTo.id)
          .orderBy(`${pivot}.position`, "asc");
      } else {
        query = query.orderBy("file.createdAt", "desc");
      }
      // A signed-in non-admin only ever sees their own files
      if (owned && user && !hasRole(context.user, roles)) {
        query = query.where("file.userId", "=", user.id);
      }
      const rows = await query
        .limit(input?.take ?? 50)
        .offset(input?.skip ?? 0)
        .execute();
      return rows.map((row: any) => toRecord(row, path));
    });

  const get = base.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const row = await context.db
      .selectFrom("file")
      .selectAll()
      .where("id", "=", input.id)
      .executeTakeFirst();
    if (!row) return null;
    enforce(perms.get, context, roles, row);
    return toRecord(row, path);
  });

  const del = base.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const row = await context.db
      .selectFrom("file")
      .selectAll()
      .where("id", "=", input.id)
      .executeTakeFirst();
    if (!row) throw new ORPCError("NOT_FOUND", { message: "File not found" });
    enforce(perms.delete, context, roles, row);

    try {
      // Attachments are cleared first: the pivots' FK to `file` would otherwise
      // make an attached file permanently undeletable.
      await context.db.transaction().execute(async (trx: any) => {
        for (const pivot of pivots) {
          await trx.deleteFrom(pivot).where("fileId", "=", input.id).execute();
        }
        await trx.deleteFrom("file").where("id", "=", input.id).execute();
      });
    } catch (error) {
      throw mapDbError(error, kind);
    }
    // Bytes go last: a failed delete leaves a retryable orphan, never a dead row
    await storage.delete(row.key);
    return { id: input.id };
  });

  const attach = base
    .input(
      z.object({
        id: z.string(),
        table: z.string(),
        entityId: z.string(),
        role: z.string().optional(),
        position: z.number().int().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const row = await context.db
        .selectFrom("file")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirst();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "File not found" });
      enforce(perms.delete, context, roles, row);
      const pivot = assertAttachable(input.table, tables);
      try {
        await context.db
          .insertInto(pivot)
          .values({
            id: crypto.randomUUID(),
            fileId: input.id,
            entityId: input.entityId,
            role: input.role ?? null,
            ...(input.position !== undefined && { position: input.position }),
          })
          .execute();
      } catch (error) {
        throw mapDbError(error, kind);
      }
      return { id: input.id };
    });

  const detach = base
    .input(z.object({ id: z.string(), table: z.string(), entityId: z.string() }))
    .handler(async ({ input, context }) => {
      const row = await context.db
        .selectFrom("file")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirst();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "File not found" });
      enforce(perms.delete, context, roles, row);
      const pivot = assertAttachable(input.table, tables);
      await context.db
        .deleteFrom(pivot)
        .where("fileId", "=", input.id)
        .where("entityId", "=", input.entityId)
        .execute();
      return { id: input.id };
    });

  return { upload, list, get, delete: del, attach, detach } as Record<string, AnyProcedure>;
}

/**
 * MIME types a browser renders as *active* content — an uploaded file served
 * with one of these as its `content-type` executes script on the API's own
 * origin. These are always sent as a download (`attachment`), never `inline`,
 * regardless of the browser's own sniffing.
 */
const INLINE_UNSAFE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
  "application/xslt+xml",
]);

/**
 * Whether the stored `content-type` is safe to render inline. Everything the
 * browser treats as markup is forced to download instead — combined with the
 * `nosniff` + sandbox CSP headers below, this closes the stored-XSS hole where
 * an attacker uploads HTML/SVG and loads it from the file route.
 */
function inlineDisposition(type: string): "inline" | "attachment" {
  return INLINE_UNSAFE_TYPES.has(type.split(";")[0]!.trim().toLowerCase())
    ? "attachment"
    : "inline";
}

/**
 * The `GET <path>` handler that serves the bytes. Downloads can't go through
 * `/rpc/**` — that speaks oRPC's wire protocol, which a browser `<img src>`
 * can't consume.
 */
export function buildFileRoute(params: {
  storage: OuterStorage;
  config: FilesConfig;
}): (event: any, context: any) => Promise<Response> {
  const { storage, config } = params;
  const permission = config.permissions?.get ?? DEFAULT_PERMISSIONS.get;
  const roles = config.roles ?? ["admin"];
  const notFound = () => new Response("Not found", { status: 404 });

  return async (event, context) => {
    const id = event.context?.params?.id;
    if (!id) return notFound();
    const row = await context.db
      .selectFrom("file")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return notFound();

    try {
      enforce(permission, context, roles, row);
    } catch {
      // 404 rather than 403 so file IDs can't be probed for existence
      return notFound();
    }

    const bytes = await storage.get(row.key);
    if (!bytes) return notFound();

    const disposition = inlineDisposition(row.type);
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        "content-type": row.type,
        "content-length": String(row.size),
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "cache-control": permission === "public" ? "public, max-age=3600" : "private, max-age=3600",
        // The uploaded `content-type` is caller-controlled, so a browser must
        // not be free to reinterpret the bytes as something executable.
        "x-content-type-options": "nosniff",
        // Defense in depth: even if a markup type slips through, `sandbox`
        // strips script execution and same-origin privileges from the response.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  };
}

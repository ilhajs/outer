import { ORPCError } from "@orpc/client";
import type { OpenAPIHandler } from "@orpc/openapi/fetch";
import {
  os,
  onError,
  createRouterClient,
  Router,
  RouterClient,
  Builder,
  AnyProcedure,
  Middleware,
} from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { betterAuth, Auth, BetterAuthOptions } from "better-auth";
import { H3, H3Event, HTTPMethod } from "h3";
import { Dialect, Kysely } from "kysely";

import { AdminConfig, AdminRouter, buildAdminProcedures } from "./admin";
import { buildFileProcedures, buildFileRoute, FilesConfig, FilesRouter } from "./files";
import { LiveProvider } from "./live";
import { createMigrator, DialectKind } from "./migrator";
import {
  actionsRequiringAuth,
  buildResourceProcedures,
  hasRole,
  ResourceOptions,
  ResourceProcedures,
} from "./resource";
import { schema, timestamps, SchemaResult, InferDB, TablesDef, ColumnDef } from "./schema";
import { createSola, Sola } from "./sola";
import { fromUnstorage, fromS3, memoryStorage, OuterStorage } from "./storage";

export { schema, timestamps };
export { fromUnstorage, fromS3, memoryStorage };
export type { OuterStorage } from "./storage";
export type { LiveProvider } from "./live";
export { liveIterable } from "./live";
export type { FilesConfig, FilesRouter, FilePermission, FileRecord } from "./files";
/** Throw from a handler to return a specific HTTP status instead of a 500. */
export { ORPCError };
export type { AuthTables, FileTables, FilesOptions } from "./schema";
export type { ResourceOptions, DialectKind };
export type {
  AdminConfig,
  AdminRouter,
  AdminMeta,
  AdminMigrationStatus,
  OuterAdminRouter,
} from "./admin";

type OuterAuth = Auth<any>;
type OuterDB<TDB> = Kysely<TDB> & {
  query: Sola<TDB>;
  /**
   * Runs `fn` inside a database transaction. The `trx` passed to `fn` is a
   * full `context.db` (Kysely + `query`), so Sola reads and Kysely writes both
   * participate in the transaction. Rolls back if `fn` throws.
   */
  transact<R>(fn: (trx: OuterDB<TDB>) => Promise<R>): Promise<R>;
};

/** The signed-in user, as Better Auth returns it (plus whatever plugins add). */
export type SessionUser = { id: string; email: string; role?: string } & Record<string, any>;
export type UserSession = { id: string; userId: string; expiresAt: Date } & Record<string, any>;

export type OuterRpcContext<TDB = any> = {
  headers: Headers;
  db: OuterDB<TDB>;
  auth?: OuterAuth;
  /**
   * Resolved once per request when `.auth()` is enabled, `null` when there's no
   * session (and always `null` without `.auth()`). Widened to non-null-typed
   * access after `.auth()` — see `AuthedContext`.
   */
  user?: SessionUser | null;
  session?: UserSession | null;
  /** The object store passed as `new Outer({ storage })`, if any. */
  storage?: OuterStorage;
};

/** Context additions `.auth()` guarantees: `auth` is present and `user`/`session` are always resolved (possibly to `null`). */
type AuthedContext = {
  auth: OuterAuth;
  user: SessionUser | null;
  session: UserSession | null;
};

/** Extracts the oRPC router type from an `Outer` or `BuiltOuter` instance. */
export type InferRouter<T> = T extends { router: infer R } ? R : never;

/** Turns dot-notation `"user.me"` into the nested router shape `{ user: { me: TProc } }`. */
type NestRoute<TPath extends string, TProc> = TPath extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: NestRoute<Rest, TProc> }
  : { [K in TPath]: TProc };

/** Deep-merges two router shapes, matching the runtime `deepMerge` behavior. */
type MergeRouters<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? A[K] extends AnyProcedure
        ? B[K]
        : B[K] extends AnyProcedure
          ? B[K]
          : MergeRouters<A[K], B[K]>
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

/**
 * Declarative access control for `.procedure()`, using the same vocabulary as
 * `.resource()`. `"owner"` is deliberately absent — there's no row to own.
 */
export type ProcedurePermission<TContext> =
  | "public"
  | "authenticated"
  | "admin"
  | ((args: { context: TContext }) => boolean | Promise<boolean>);

export type ProcedureOptions<TContext> = {
  /** Defaults to `"public"` — no check, matching procedures without options. */
  permission?: ProcedurePermission<TContext>;
  /** Roles accepted by `"admin"`. Defaults to `["admin"]`. */
  roles?: string[];
};

/**
 * oRPC middleware enforcing a procedure permission. Reads the `user` that
 * `.auth()` already resolved for this request rather than re-querying it.
 */
function procedurePermission(
  permission: Exclude<ProcedurePermission<any>, "public">,
  resources: { auth: OuterAuth | undefined },
  roles: string[] = ["admin"],
) {
  return async ({ context, next }: any) => {
    if (typeof permission === "function") {
      if (!(await permission({ context }))) {
        throw new ORPCError("FORBIDDEN", { message: "Permission denied" });
      }
      return next();
    }
    if (!resources.auth) {
      throw new Error(
        "This procedure permission requires auth — call `.auth()` on the Outer instance before `.build()`",
      );
    }
    if (!context.user) throw new ORPCError("UNAUTHORIZED", { message: "You must be signed in" });
    if (permission === "admin" && !hasRole(context.user, roles)) {
      throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
    }
    return next();
  };
}

/** Extracts the `ownerColumn` literal from resource options so create inputs can omit it (it's auto-filled from the session). */
type OwnerColumnOf<TOptions> = TOptions extends { ownerColumn: infer O extends string } ? O : never;

export type AuthConfig = Omit<BetterAuthOptions, "database"> & {
  /** Secret used by Better Auth to sign/encrypt sessions, cookies, and tokens. */
  secret: string;
  /**
   * Defaults to the `baseUrl` passed to `new Outer({ baseUrl })` — set this to override it just for auth.
   * Accepts Better Auth's `DynamicBaseURLConfig` (`{ allowedHosts, fallback?, protocol? }`) for deployments
   * behind a dynamic/preview domain (Vercel previews, StackBlitz, etc.) where the origin isn't known upfront.
   */
  baseURL?: BetterAuthOptions["baseURL"];
};

export type OuterParams = {
  name?: string;
  baseUrl?: string;
  /**
   * A Kysely `Dialect` plus the dialect family it belongs to — `kind` drives
   * DDL generation, Better Auth's schema, and DB error mapping, so it must
   * match the dialect you provide. For the zero-infra embedded Postgres
   * default, use `pglite()` from `@outerjs/server/pglite`:
   * `new Outer({ db: pglite() })`. For anything else (network Postgres,
   * Cloudflare D1/Durable Objects, etc.) construct the `Dialect` yourself.
   */
  db: { dialect: Dialect; kind: DialectKind; live?: LiveProvider };
  /**
   * Cross-origin browser callers allowed to reach `/rpc/**`, `/api/auth/**`,
   * and the admin API. Lives on the constructor (not a chain method) so it's
   * the single source of truth: `.auth()` always folds these origins into
   * Better Auth's `trustedOrigins` regardless of call order. Without it, no
   * `Access-Control-Allow-Origin` header is set — same-origin requests and
   * non-browser clients are unaffected.
   */
  cors?: CorsConfig;
  /**
   * Object store for file bytes, surfaced as `context.storage` and used by
   * `.files()`. Wrap unstorage/Nitro's `useStorage()` with `fromUnstorage()`,
   * an S3 client with `fromS3()`, or pass any `OuterStorage` implementation.
   */
  storage?: OuterStorage;
};

type OuterRoute<TContext> = {
  method: HTTPMethod | Lowercase<HTTPMethod> | "";
  path: string;
  handler: (event: H3Event, context: TContext) => unknown;
};

type OuterResources = {
  dialect: Dialect;
  dialectKind: DialectKind;
  /** Backs `context.db.query.<table>.live()`; absent for dialects that can't stream changes. */
  live: LiveProvider | undefined;
  db: Kysely<any>;
  baseUrl: string | undefined;
  auth: OuterAuth | undefined;
  openapiEnabled: boolean;
  routes: OuterRoute<any>[];
  /** `"resource.action"` entries whose permission requires a session — checked against `auth` at `.build()`. */
  authRequiredBy: string[];
  cors: CorsConfig | undefined;
  /** Set by `.admin()` — the `_admin.*` procedures are built at `.build()` so they see the final schema and migrator. */
  admin: AdminConfig | undefined;
  /** Set by `.files()` — the `file.*` procedures are built at `.build()` so they see the final schema. */
  files: FilesConfig | undefined;
  storage: OuterStorage | undefined;
};

export type OpenApiConfig = {
  /** Whether to mount `GET /openapi.json`. Defaults to `true` when `.openapi()` is called — pass `import.meta.env.DEV` or similar to gate it on dev/staging only. */
  enabled?: boolean;
};

export type CorsConfig = {
  /** Allowed origins. Also merged into Better Auth's `trustedOrigins` when `.auth()` is used. */
  origins: string[];
  credentials?: boolean;
};

/**
 * `@orpc/openapi` and `@orpc/zod` are optional peer dependencies — only needed
 * when `.openapi()` is enabled, so they're loaded lazily on the first request
 * to an OpenAPI route rather than imported at module load.
 */
async function loadOpenApiModules() {
  try {
    const [openapi, openapiFetch, orpcZod] = await Promise.all([
      import("@orpc/openapi"),
      import("@orpc/openapi/fetch"),
      import("@orpc/zod"),
    ]);
    return {
      OpenAPIGenerator: openapi.OpenAPIGenerator,
      OpenAPIHandler: openapiFetch.OpenAPIHandler,
      ZodToJsonSchemaConverter: orpcZod.ZodToJsonSchemaConverter,
    };
  } catch (cause) {
    throw new Error(
      "`.openapi()` requires the optional peer dependencies `@orpc/openapi` and `@orpc/zod`. Install them with: bun add @orpc/openapi @orpc/zod",
      { cause },
    );
  }
}

function deepMerge({
  a,
  b,
}: {
  a: Record<string, any>;
  b: Record<string, any>;
}): Record<string, any> {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (key in result && typeof result[key] === "object" && typeof b[key] === "object") {
      result[key] = deepMerge({ a: result[key], b: b[key] });
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

export class Outer<
  TContext extends OuterRpcContext<TDB> = OuterRpcContext,
  TDB = any,
  TRouter extends Record<string, any> = Record<never, never>,
  TTables extends TablesDef = TablesDef,
> {
  private pendingRouter: TRouter;
  private readonly resources: OuterResources;
  private readonly pendingBase: Builder<TContext & object, Record<never, never>>;
  private readonly schemas: SchemaResult<any>[];
  private readonly name: string | undefined;

  constructor(params: OuterParams);
  constructor(
    params: { name?: string },
    _resources: OuterResources,
    _base: Builder<TContext & object, Record<never, never>>,
    _router: TRouter,
    _schemas: SchemaResult<any>[],
  );
  constructor(
    params: OuterParams | { name?: string },
    _resources?: OuterResources,
    _base?: Builder<TContext & object, Record<never, never>>,
    _router?: TRouter,
    _schemas?: SchemaResult<any>[],
  ) {
    this.name = params.name;
    if (_resources && _base) {
      // Clone path: copy resources (including mutable arrays) so mutations don't bleed across instances
      this.resources = {
        ..._resources,
        routes: [..._resources.routes],
        authRequiredBy: [..._resources.authRequiredBy],
      };
      this.pendingBase = _base;
      this.pendingRouter = _router ?? ({} as TRouter);
      this.schemas = _schemas ?? [];
    } else {
      const { db: dbConfig, baseUrl, cors, storage } = params as OuterParams;
      const { dialect, kind: dialectKind, live } = dbConfig;
      const db = new Kysely<any>({ dialect });
      this.resources = {
        dialect,
        dialectKind,
        live,
        db,
        baseUrl,
        auth: undefined,
        openapiEnabled: false,
        routes: [],
        authRequiredBy: [],
        cors,
        admin: undefined,
        files: undefined,
        storage,
      };
      this.pendingBase = os.$context<OuterRpcContext>() as unknown as Builder<
        TContext & object,
        Record<never, never>
      >;
      this.pendingRouter = {} as TRouter;
      this.schemas = [];
    }
  }

  /** Toggles `GET /openapi.json`. Not mounted unless this is called; calling it with no args enables it. Must be called before `.build()`. Can appear anywhere in the chain. */
  openapi(config?: OpenApiConfig): this {
    this.resources.openapiEnabled = config?.enabled ?? true;
    return this;
  }

  /**
   * Enables the admin API — meta/schema introspection, migration status, and
   * table CRUD — under the reserved `_admin` namespace (`/rpc/_admin/**`).
   * Every admin procedure requires a signed-in session with `role === "admin"`
   * (Better Auth admin plugin, or an equivalent `role` field on `user`), so
   * `.auth()` must be called somewhere in the chain — `.build()` throws otherwise.
   * For a dashboard hosted on another origin, list that origin in
   * `new Outer({ cors: { origins } })` so browsers can reach the API.
   */
  admin(
    config: AdminConfig = {},
  ): Outer<TContext, TDB, MergeRouters<TRouter, { _admin: AdminRouter }>, TTables> {
    this.resources.admin = config;
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<TRouter, { _admin: AdminRouter }>,
      TTables
    >;
  }

  /**
   * Enables Better Auth and mounts `/api/auth/**`. Must be called before
   * `.build()`. Can appear anywhere in the chain. Narrows `context.auth` to
   * non-null and adds `context.user` / `context.session`, resolved once per
   * request — no `getSession` middleware needed.
   */
  auth(config: AuthConfig): Outer<TContext & AuthedContext, TDB, TRouter, TTables> {
    const corsOrigins = this.resources.cors?.origins ?? [];
    const existingTrustedOrigins = Array.isArray(config.trustedOrigins)
      ? config.trustedOrigins
      : [];
    this.resources.auth = betterAuth({
      baseURL: this.resources.baseUrl,
      ...config,
      ...(corsOrigins.length > 0 && {
        trustedOrigins: [...corsOrigins, ...existingTrustedOrigins],
      }),
      database: { type: this.resources.dialectKind, dialect: this.resources.dialect },
    });
    return new Outer<TContext & AuthedContext, TDB, TRouter, TTables>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase as unknown as Builder<
        (TContext & AuthedContext) & object,
        Record<never, never>
      >,
      this.pendingRouter,
      this.schemas,
    );
  }

  schema<T extends TablesDef>(
    s: SchemaResult<T>,
  ): Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter, T> {
    return new Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter, T>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      os.$context<OuterRpcContext<InferDB<T>>>() as unknown as Builder<
        OuterRpcContext<InferDB<T>> & object,
        Record<never, never>
      >,
      this.pendingRouter,
      [...this.schemas, s],
    );
  }

  middleware<TOutContext extends Record<string, unknown>>(
    mw: Middleware<TContext & object, TOutContext, unknown, unknown, Record<never, never>>,
  ): Outer<TContext & TOutContext, TDB, TRouter, TTables> {
    return new Outer<TContext & TOutContext, TDB, TRouter, TTables>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase.use(mw as any) as unknown as Builder<
        TContext & TOutContext & object,
        Record<never, never>
      >,
      this.pendingRouter,
      this.schemas,
    );
  }

  /**
   * Registers the `file.*` procedures (`upload`, `list`, `get`, `delete`,
   * `attach`, `detach`) plus a `GET /files/:id` route that serves the bytes.
   * Requires a `file` table from `schema().files()` and an `OuterStorage` —
   * either `new Outer({ storage })` or `.files({ storage })`.
   *
   * Permissions default to upload/list `"authenticated"` and get/delete
   * `"owner"`, so files are private to whoever uploaded them.
   */
  files(
    config: FilesConfig = {},
  ): Outer<TContext, TDB, MergeRouters<TRouter, { file: FilesRouter }>, TTables> {
    this.resources.files = config;
    const permissions = config.permissions ?? {};
    for (const [action, permission] of Object.entries({
      upload: permissions.upload ?? "authenticated",
      list: permissions.list ?? "authenticated",
      get: permissions.get ?? "owner",
      delete: permissions.delete ?? "owner",
    })) {
      if (permission !== "public") this.resources.authRequiredBy.push(`file.${action}`);
    }
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<TRouter, { file: FilesRouter }>,
      TTables
    >;
  }

  procedure<TName extends string, TProc extends AnyProcedure>(
    name: TName,
    cb: (base: Builder<TContext & object, Record<never, never>>) => TProc,
    options?: ProcedureOptions<TContext>,
  ): Outer<TContext, TDB, MergeRouters<TRouter, NestRoute<TName, TProc>>, TTables> {
    let base = this.pendingBase;
    if (options?.permission && options.permission !== "public") {
      this.resources.authRequiredBy.push(name);
      base = base.use(
        procedurePermission(options.permission, this.resources, options.roles) as any,
      ) as any;
    }
    this.addToRouter(name, cb(base));
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<TRouter, NestRoute<TName, TProc>>,
      TTables
    >;
  }

  /** Mounts a raw H3 route (e.g. for webhooks or custom REST endpoints) alongside `.procedure()`-defined RPC routes. Registered before `/rpc/**`, so it takes precedence on overlapping paths. */
  route(
    method: HTTPMethod | Lowercase<HTTPMethod> | "",
    path: string,
    handler: (event: H3Event, context: TContext) => unknown,
  ): this {
    this.resources.routes.push({ method, path, handler });
    return this;
  }

  resource<
    TName extends keyof TTables & keyof TDB & string,
    const TOptions extends ResourceOptions = Record<never, never>,
  >(
    name: TName,
    options?: TOptions,
  ): Outer<
    TContext,
    TDB,
    MergeRouters<
      TRouter,
      NestRoute<TName, ResourceProcedures<TTables[TName], OwnerColumnOf<TOptions>>>
    >,
    TTables
  > {
    const latestSchema = this.schemas.at(-1);
    const cols = latestSchema?.tables[name] as Record<string, ColumnDef> | undefined;
    if (!cols) throw new Error(`Table "${name}" not found in schema`);
    for (const action of actionsRequiringAuth(options?.permissions ?? {})) {
      this.resources.authRequiredBy.push(`${name}.${action}`);
    }
    for (const [action, proc] of Object.entries(
      buildResourceProcedures(
        name,
        cols,
        this.pendingBase as any,
        options,
        this.resources.dialectKind,
        { tables: latestSchema?.tables ?? {}, relations: latestSchema?.relations ?? [] },
      ),
    )) {
      this.addToRouter(`${name}.${action}`, proc);
    }
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<
        TRouter,
        NestRoute<TName, ResourceProcedures<TTables[TName], OwnerColumnOf<TOptions>>>
      >,
      TTables
    >;
  }

  /** The internal oRPC router — also available on `BuiltOuter` after `.build()`. Use `InferRouter<typeof instance>` for type-safe client generation. */
  get router(): TRouter {
    return this.pendingRouter;
  }

  build(): BuiltOuter<TRouter, TDB> {
    const { db, auth, authRequiredBy, admin, cors, files } = this.resources;

    if (authRequiredBy.length > 0 && !auth) {
      throw new Error(
        `The following resource actions require a signed-in session but \`.auth()\` was never called: ${authRequiredBy.join(", ")}. Call \`.auth({ secret, ... })\` before \`.build()\`.`,
      );
    }
    if (files) {
      const tables = this.schemas.at(-1)?.tables ?? {};
      if (!tables["file"]) {
        throw new Error(
          '`.files()` requires a `file` table — add `.files()` to your schema: `schema("1.0.0").auth().files()`.',
        );
      }
      if (!(files.storage ?? this.resources.storage)) {
        throw new Error(
          '`.files()` needs somewhere to put the bytes. Pass `new Outer({ storage })` or `.files({ storage })` — e.g. `fromUnstorage(useStorage("fs"))`.',
        );
      }
      if (files.path && !files.path.includes(":id")) {
        throw new Error(`\`.files({ path })\` must contain ":id" — got "${files.path}".`);
      }
    }
    if (admin && !auth) {
      throw new Error(
        "`.admin()` requires a signed-in admin session to guard the admin API, but `.auth()` was never called. Call `.auth({ secret, ... })` before `.build()`.",
      );
    }

    const migrator = createMigrator({
      db,
      schemas: this.schemas,
      kind: this.resources.dialectKind,
    });

    if (admin) {
      const adminProcedures = buildAdminProcedures({
        base: this.pendingBase as any,
        name: this.name,
        schemas: this.schemas,
        kind: this.resources.dialectKind,
        migrator,
        openapi: this.resources.openapiEnabled,
        config: admin,
      });
      for (const [procName, proc] of Object.entries(adminProcedures)) {
        this.addToRouter(`_admin.${procName}`, proc, { internal: true });
      }
    }

    if (files) {
      const latest = this.schemas.at(-1);
      const fileTables = latest?.tables ?? {};
      const fileStorage = (files.storage ?? this.resources.storage)!;
      const fileProcedures = buildFileProcedures({
        base: this.pendingBase as any,
        storage: fileStorage,
        config: files,
        tables: fileTables,
        owned: "userId" in ((fileTables["file"] ?? {}) as Record<string, unknown>),
        kind: this.resources.dialectKind,
      });
      for (const [procName, proc] of Object.entries(fileProcedures)) {
        this.addToRouter(`file.${procName}`, proc);
      }
      // Registered ahead of /rpc/** like any other .route(), so it wins on overlap
      this.resources.routes.push({
        method: "get",
        path: files.path ?? "/files/:id",
        handler: buildFileRoute({ storage: fileStorage, config: files }) as any,
      });
    }

    const router: Router<OuterRpcContext<TDB>> = this.pendingRouter as unknown as Router<
      OuterRpcContext<TDB>
    >;

    const latestSchema = this.schemas.at(-1);
    const solaConfig = {
      tables: latestSchema?.tables ?? {},
      relations: latestSchema?.relations ?? [],
      live: this.resources.live,
    };
    const wrapDb = (k: Kysely<any>): OuterDB<TDB> =>
      Object.assign(k as Kysely<TDB>, {
        query: createSola<TDB>({ db: k, ...solaConfig }),
        transact: <R>(fn: (trx: OuterDB<TDB>) => Promise<R>): Promise<R> =>
          k.transaction().execute((trx) => fn(wrapDb(trx))),
      }) as OuterDB<TDB>;
    const typedDb = wrapDb(db);

    const storage = this.resources.storage;

    /**
     * Per-request context. When `.auth()` is enabled the session is resolved
     * once here and shared by every procedure, route, and permission check, so
     * apps no longer need a `getSession` middleware and a request never pays
     * for more than one session lookup.
     */
    const buildContext = async (event: H3Event): Promise<OuterRpcContext<TDB>> => {
      const base = {
        headers: event.req.headers,
        db: typedDb,
        ...(storage && { storage }),
      } as OuterRpcContext<TDB>;
      if (!auth) return { ...base, user: null, session: null };
      const resolved = await auth.api.getSession({ headers: event.req.headers }).catch(() => null);
      return {
        ...base,
        auth,
        user: (resolved?.user as SessionUser | undefined) ?? null,
        session: (resolved?.session as UserSession | undefined) ?? null,
      };
    };

    const rpc = new RPCHandler(router, {
      interceptors: [
        onError((error) => {
          // ORPCError is an intentional application response (400/401/403/404/409, etc.) —
          // only log genuinely unexpected failures to avoid noisy/sensitive logs.
          if (!(error instanceof ORPCError)) console.error(error);
        }),
      ],
    });

    let server = new H3();

    if (cors) {
      server = server.use(async (event, next) => {
        // Vary on every response (not just allowed origins) so shared caches
        // never serve an ACAO-bearing response to a different origin.
        event.res.headers.set("Vary", "Origin");
        const origin = event.req.headers.get("origin");
        if (origin && cors.origins.includes(origin)) {
          event.res.headers.set("Access-Control-Allow-Origin", origin);
          if (cors.credentials) event.res.headers.set("Access-Control-Allow-Credentials", "true");
          event.res.headers.set(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          );
          event.res.headers.set(
            "Access-Control-Allow-Headers",
            event.req.headers.get("access-control-request-headers") ?? "content-type",
          );
          event.res.headers.set("Access-Control-Max-Age", "600");
        }
        // Short-circuit only real preflights, so custom OPTIONS routes still work
        if (
          event.req.method === "OPTIONS" &&
          event.req.headers.has("access-control-request-method")
        ) {
          event.res.status = 204;
          return "";
        }
        const result = await next();
        // H3 merges `event.res` headers into a returned `Response` only when it's
        // 2xx — re-apply them onto error responses (oRPC 4xx, auth 401s, ...) so
        // browsers can read the error instead of failing the whole fetch on CORS.
        if (result instanceof Response && !result.ok) {
          const merge = (target: Headers) => {
            for (const [name, value] of event.res.headers) {
              if (name === "set-cookie") target.append(name, value);
              else target.set(name, value);
            }
          };
          try {
            merge(result.headers);
          } catch {
            // immutable headers — rebuild the response
            const headers = new Headers(result.headers);
            merge(headers);
            return new Response(result.body, {
              status: result.status,
              statusText: result.statusText,
              headers,
            });
          }
        }
        return result;
      });
    }

    if (this.resources.openapiEnabled) {
      let modulesPromise: ReturnType<typeof loadOpenApiModules> | undefined;
      const modules = () => (modulesPromise ??= loadOpenApiModules());
      const restBase = `${this.resources.baseUrl ?? ""}/rest`;
      server = server.get("/openapi.json", async () => {
        const { OpenAPIGenerator, ZodToJsonSchemaConverter } = await modules();
        const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
        return generator.generate(router, {
          base: {
            info: {
              title: this.name ?? "Outer API",
              version: latestSchema?.version ?? "0.0.0",
            },
            servers: [{ url: restBase }],
          },
        });
      });

      // Plain-JSON REST surface matching the OpenAPI spec (the /rpc/** handler
      // speaks oRPC's own wire protocol, which spec-driven clients can't use).
      let openapiHandler: OpenAPIHandler<OuterRpcContext<TDB>> | undefined;
      server = server.all("/rest/**", async (event) => {
        openapiHandler ??= new (await modules()).OpenAPIHandler(router, {
          interceptors: [
            onError((error) => {
              if (!(error instanceof ORPCError)) console.error(error);
            }),
          ],
        });
        const { response } = await openapiHandler.handle(event.req, {
          prefix: "/rest",
          context: await buildContext(event),
        });
        return response;
      });
    }

    if (auth) {
      server = server.all("/api/auth/**", (event) => auth.handler(event.req));
    }

    for (const { method, path, handler } of this.resources.routes) {
      server = server.on(method, path, async (event) =>
        handler(event, (await buildContext(event)) as any),
      );
    }

    server = server.all("/rpc/**", async (event) => {
      const { response } = await rpc.handle(event.req, {
        prefix: "/rpc",
        context: await buildContext(event),
      });
      return response;
    });

    return new BuiltOuter(server, typedDb, migrator, this.pendingRouter, auth);
  }

  private addToRouter(dotName: string, proc: AnyProcedure, opts?: { internal?: boolean }): void {
    if (!opts?.internal && (dotName === "_admin" || dotName.startsWith("_admin."))) {
      throw new Error(
        `The "_admin" namespace is reserved for the admin API (\`.admin()\`). Choose a different name than "${dotName}".`,
      );
    }
    const keys = dotName.split(".");
    let cursor: any = this.pendingRouter;
    for (const key of keys) {
      if (cursor == null || typeof cursor !== "object") break;
      cursor = cursor[key];
    }
    if (cursor !== undefined) {
      throw new Error(
        `Procedure name collision: "${dotName}" is already registered. Choose a different name.`,
      );
    }

    const nested = keys.reduceRight<Record<string, any> | AnyProcedure>(
      (acc, key) => ({ [key]: acc }),
      proc,
    );
    this.pendingRouter = deepMerge({
      a: this.pendingRouter as Record<string, any>,
      b: nested as Record<string, any>,
    }) as TRouter;
  }
}

export class BuiltOuter<TRouter extends Record<string, any> = Router<any>, TDB = any> {
  readonly migrator: ReturnType<typeof createMigrator>;
  readonly router: TRouter;
  /** The same `db` handed to procedures (Kysely + `query` + `transact`) — use it for out-of-band work like seeding after migrations. */
  readonly db: OuterDB<TDB>;
  private readonly server: H3;
  private readonly auth: OuterAuth | undefined;

  constructor(
    server: H3,
    db: OuterDB<TDB>,
    migrator: ReturnType<typeof createMigrator>,
    router: TRouter,
    auth?: OuterAuth,
  ) {
    this.server = server;
    this.db = db;
    this.auth = auth;
    this.migrator = migrator;
    this.router = router;
  }

  async handle(request: Request): Promise<Response> {
    return this.server.fetch(request);
  }

  /**
   * In-process router client — calls procedures directly, skipping HTTP and
   * the oRPC wire protocol entirely. Use it for SSR (Server Components,
   * server functions) where the server owns the request: pass the incoming
   * request's headers (or a function returning them, evaluated per call) so
   * permissions and `context.auth` see the caller's session.
   */
  client(
    headers: Headers | (() => Headers | Promise<Headers>) = new Headers(),
  ): RouterClient<TRouter> {
    return createRouterClient(this.router as Router<OuterRpcContext>, {
      context: async (): Promise<OuterRpcContext> => ({
        headers: typeof headers === "function" ? await headers() : headers,
        db: this.db as OuterRpcContext["db"],
        ...(this.auth && { auth: this.auth }),
      }),
    }) as RouterClient<TRouter>;
  }
}

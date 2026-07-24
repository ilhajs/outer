import { ORPCError } from "@orpc/client";
import { os, onError, Router, Builder, AnyProcedure, Middleware } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { betterAuth } from "better-auth";
import { H3, H3Event, HTTPMethod } from "h3";
import { Kysely, sql } from "kysely";

import { AdminConfig, AdminRouter, buildAdminProcedures } from "./admin";
import { BuiltOuter } from "./built-outer";
import { createContextFactory } from "./context";
import { createCorsMiddleware } from "./cors";
import { buildFileProcedures, buildFileRoute, FilesConfig, FilesRouter } from "./files";
import { mountMcpHandler } from "./mcp-handler";
import { compareVersions, createMigrator } from "./migrator";
import { mountOpenApiRoutes } from "./openapi";
import { procedurePermission } from "./permissions";
import type { OuterPlugin, PluginContext, PluginResult } from "./plugin";
import { memoryRateLimitStore, createRateLimitMiddleware } from "./rate-limit";
import {
  actionsRequiringAuth,
  buildResourceProcedures,
  ResourceOptions,
  ResourceProcedures,
} from "./resource";
import { cloneResources, freezeResourcesSnapshot } from "./resources";
import type { SchemaResult, InferDB, TablesDef, ColumnDef } from "./schema";
import { createSola } from "./sola";
import type {
  AuthConfig,
  AuthedContext,
  ErrorSource,
  ErrorSourcesOf,
  McpConfig,
  MergeRouters,
  NestRoute,
  OpenApiConfig,
  OuterDB,
  OuterParams,
  OuterResources,
  OuterRpcContext,
  OwnerColumnOf,
  ProcedureOptions,
} from "./types";
import { deepMerge } from "./utils";

export class Outer<
  TContext extends OuterRpcContext<TDB> = OuterRpcContext,
  TDB = any,
  TRouter extends Record<string, any> = Record<never, never>,
  TTables extends TablesDef = TablesDef,
  TOpenApi extends boolean = false,
  TMcp extends boolean = false,
> {
  private pendingRouter: TRouter;
  private readonly resources: OuterResources;
  private readonly pendingBase: Builder<TContext & object, Record<never, never>>;
  private readonly schemas: SchemaResult<any>[];
  private readonly name: string | undefined;
  private plugins: OuterPlugin[] = [];

  constructor(params: OuterParams<ErrorSourcesOf<TOpenApi, TMcp>>);
  constructor(
    params: { name?: string },
    _resources: OuterResources,
    _base: Builder<TContext & object, Record<never, never>>,
    _router: TRouter,
    _schemas: SchemaResult<any>[],
    _plugins?: OuterPlugin[],
  );
  constructor(
    params: OuterParams<ErrorSourcesOf<TOpenApi, TMcp>> | { name?: string },
    _resources?: OuterResources,
    _base?: Builder<TContext & object, Record<never, never>>,
    _router?: TRouter,
    _schemas?: SchemaResult<any>[],
    _plugins?: OuterPlugin[],
  ) {
    this.name = params.name;
    if (_resources && _base) {
      // Clone path: deep-enough copy so later mutations never bleed across instances
      this.resources = cloneResources(_resources);
      this.pendingBase = _base;
      this.pendingRouter = _router ?? ({} as TRouter);
      this.schemas = _schemas ?? [];
      this.plugins = [...(_plugins ?? [])];
    } else {
      const {
        db: dbConfig,
        baseUrl,
        cors,
        storage,
        secrets,
        kv,
        onError: onErrorHook,
        health,
        rateLimit,
      } = params as OuterParams;
      const { dialect, kind: dialectKind, live } = dbConfig;
      const db = new Kysely<any>({ dialect });
      this.resources = {
        dialect,
        dialectKind,
        live,
        db,
        baseUrl: resolveBaseUrl(baseUrl),
        auth: undefined,
        openapiEnabled: false,
        mcp: undefined,
        routes: [],
        authRequiredBy: [],
        cors,
        admin: undefined,
        files: undefined,
        storage,
        secrets,
        kv,
        onError: onErrorHook as OuterResources["onError"],
        health,
        rateLimit,
      };
      this.pendingBase = os.$context<OuterRpcContext>() as unknown as Builder<
        TContext & object,
        Record<never, never>
      >;
      this.pendingRouter = {} as TRouter;
      this.schemas = [];
    }
  }

  /**
   * Serves the router as an MCP server over the Streamable HTTP transport, so
   * Claude, IDEs, and agents can call your procedures as tools.
   *
   * **Exposure is opt-in per procedure** — only procedures tagged with the
   * `mcp` meta helper appear. Everything else, including the whole `_admin`
   * namespace and `file.*`, stays invisible:
   *
   * ```ts
   * import { mcp } from "@outerjs/server";
   *
   * .procedure("post.search", (base) =>
   *   base.meta(mcp.tool({ description: "Search posts by title" }))
   *     .input(z.object({ q: z.string() }))
   *     .handler(({ input, context }) => ...),
   * )
   * ```
   *
   * Permissions are unchanged: the endpoint resolves a session the same way
   * `/rpc/**` does, so a caller must authenticate — a cookie for browsers, or
   * an API key (`@better-auth/api-key`) for headless clients.
   *
   * Requires the optional peers `orpc-mcp` and `@orpc/zod`.
   */
  mcp(config?: McpConfig): Outer<TContext, TDB, TRouter, TTables, TOpenApi, true> {
    this.resources.mcp = { enabled: config?.enabled ?? true, ...config };
    return this as Outer<TContext, TDB, TRouter, TTables, TOpenApi, true>;
  }

  /** Toggles `GET /openapi.json`. Not mounted unless this is called; calling it with no args enables it. Must be called before `.build()`. Can appear anywhere in the chain. */
  openapi(config?: OpenApiConfig): Outer<TContext, TDB, TRouter, TTables, true, TMcp> {
    this.resources.openapiEnabled = config?.enabled ?? true;
    return this as Outer<TContext, TDB, TRouter, TTables, true, TMcp>;
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
  ): Outer<TContext, TDB, MergeRouters<TRouter, { _admin: AdminRouter }>, TTables, TOpenApi, TMcp> {
    this.resources.admin = config;
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<TRouter, { _admin: AdminRouter }>,
      TTables,
      TOpenApi,
      TMcp
    >;
  }

  /**
   * Enables Better Auth and mounts `/api/auth/**`. Must be called before
   * `.build()`. Can appear anywhere in the chain. Narrows `context.auth` to
   * non-null and adds `context.user` / `context.session`, resolved once per
   * request — no `getSession` middleware needed.
   */
  auth(config: AuthConfig): Outer<TContext & AuthedContext, TDB, TRouter, TTables, TOpenApi, TMcp> {
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
    return new Outer<TContext & AuthedContext, TDB, TRouter, TTables, TOpenApi, TMcp>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase as unknown as Builder<
        (TContext & AuthedContext) & object,
        Record<never, never>
      >,
      this.pendingRouter,
      this.schemas,
      this.plugins,
    );
  }

  schema<T extends TablesDef>(
    s: SchemaResult<T>,
  ): Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter, T, TOpenApi, TMcp> {
    const previous = this.schemas.at(-1);
    if (previous && compareVersions(s.version, previous.version) <= 0) {
      throw new Error(
        `Schema version "${s.version}" must be greater than the previous version "${previous.version}". Register schemas in ascending order.`,
      );
    }
    // Catch the lexicographic/numeric mismatch early — Kysely applies migrations
    // in lexicographic name order, so "1.10.0" before "1.2.0" would silently reorder.
    const versions = [...this.schemas.map((x) => x.version), s.version];
    const numericOrder = [...versions].sort(compareVersions);
    const lexicalOrder = [...versions].sort();
    if (numericOrder.some((v, i) => v !== lexicalOrder[i])) {
      throw new Error(
        `Schema versions [${numericOrder.join(", ")}] sort correctly by number but not lexicographically, ` +
          `and migrations run in lexicographic order internally — this would apply them out of order. ` +
          `Zero-pad each segment (e.g. "1.02.00" instead of "1.2.0") so numeric and lexicographic order match.`,
      );
    }
    return new Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter, T, TOpenApi, TMcp>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      os.$context<OuterRpcContext<InferDB<T>>>() as unknown as Builder<
        OuterRpcContext<InferDB<T>> & object,
        Record<never, never>
      >,
      this.pendingRouter,
      [...this.schemas, s],
      this.plugins,
    );
  }

  middleware<TOutContext extends Record<string, unknown>>(
    mw: Middleware<TContext & object, TOutContext, unknown, unknown, Record<never, never>>,
  ): Outer<TContext & TOutContext, TDB, TRouter, TTables, TOpenApi, TMcp> {
    return new Outer<TContext & TOutContext, TDB, TRouter, TTables, TOpenApi, TMcp>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase.use(mw as any) as unknown as Builder<
        TContext & TOutContext & object,
        Record<never, never>
      >,
      this.pendingRouter,
      this.schemas,
      this.plugins,
    );
  }

  /**
   * Registers a plugin. Plugins can add procedures, routes, and middleware at
   * `.build()` time. Can appear anywhere in the chain. Double-registration of
   * the same plugin name throws.
   */
  use(plugin: OuterPlugin): this {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }
    plugin.configure?.();
    this.plugins.push(plugin);
    return this;
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
  ): Outer<TContext, TDB, MergeRouters<TRouter, { file: FilesRouter }>, TTables, TOpenApi, TMcp> {
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
      TTables,
      TOpenApi,
      TMcp
    >;
  }

  procedure<TName extends string, TProc extends AnyProcedure>(
    name: TName,
    cb: (base: Builder<TContext & object, Record<never, never>>) => TProc,
    options?: ProcedureOptions<TContext>,
  ): Outer<TContext, TDB, MergeRouters<TRouter, NestRoute<TName, TProc>>, TTables, TOpenApi, TMcp> {
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
      TTables,
      TOpenApi,
      TMcp
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
    TTables,
    TOpenApi,
    TMcp
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
      TTables,
      TOpenApi,
      TMcp
    >;
  }

  /** The internal oRPC router — also available on `BuiltOuter` after `.build()`. Use `InferRouter<typeof instance>` for type-safe client generation. */
  get router(): TRouter {
    return this.pendingRouter;
  }

  build(): BuiltOuter<TRouter, TDB, TOpenApi, TMcp> {
    validateConfig(this.resources, this.schemas);
    const assembled = this.assembleRouter();
    return mountServer(assembled);
  }

  /**
   * Convenience for the common `build()` + `migrateToLatest()` pair. Throws if
   * migration fails. Use `.build()` when you need manual migration control.
   */
  async start(): Promise<BuiltOuter<TRouter, TDB, TOpenApi, TMcp>> {
    const built = this.build();
    const { error } = await built.migrator.migrateToLatest();
    if (error) throw error;
    return built;
  }

  /**
   * Builds the router, procedures, migrator, context factory, and typed DB —
   * everything except the HTTP server.
   */
  private assembleRouter(): AssembledOuter<TRouter, TDB> {
    const { db, auth, admin, files } = this.resources;

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

    const pluginCtx: PluginContext = {
      resources: freezeResourcesSnapshot(this.resources),
      base: this.pendingBase,
      schemas: this.schemas,
      name: this.name,
    };

    for (const plugin of this.plugins) {
      plugin.validate?.(pluginCtx);
    }

    const pluginMiddleware: NonNullable<PluginResult["middleware"]> = [];
    for (const plugin of this.plugins) {
      const result = plugin.build?.(pluginCtx);
      if (!result) continue;
      if (result.procedures) {
        for (const [procName, proc] of Object.entries(result.procedures)) {
          this.addToRouter(procName, proc);
        }
      }
      if (result.routes) {
        for (const route of result.routes) {
          this.resources.routes.push(route as any);
        }
      }
      if (result.middleware) {
        pluginMiddleware.push(...result.middleware);
      }
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

    /**
     * Per-request context. When `.auth()` is enabled the session is resolved
     * once here and shared by every procedure, route, and permission check, so
     * apps no longer need a `getSession` middleware and a request never pays
     * for more than one session lookup.
     */
    const contextFactory = createContextFactory<TDB>({
      typedDb,
      auth,
      storage: this.resources.storage,
      secrets: this.resources.secrets,
      kv: this.resources.kv,
    });

    return {
      router,
      pendingRouter: this.pendingRouter,
      migrator,
      typedDb,
      contextFactory,
      resources: this.resources,
      latestSchema,
      pluginMiddleware,
      name: this.name,
    };
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

type AssembledOuter<TRouter, TDB> = {
  router: Router<OuterRpcContext<TDB>>;
  pendingRouter: TRouter;
  migrator: ReturnType<typeof createMigrator>;
  typedDb: OuterDB<TDB>;
  contextFactory: (headers: Headers) => Promise<OuterRpcContext<TDB>>;
  resources: OuterResources;
  latestSchema: SchemaResult<any> | undefined;
  pluginMiddleware: NonNullable<PluginResult["middleware"]>;
  name: string | undefined;
};

/** Phase 1: pure precondition checks. Throws on invalid state. */
function validateConfig(resources: OuterResources, schemas: SchemaResult<any>[]): void {
  const { auth, authRequiredBy, admin, cors, files } = resources;

  if (authRequiredBy.length > 0 && !auth) {
    throw new Error(
      `The following resource actions require a signed-in session but \`.auth()\` was never called: ${authRequiredBy.join(", ")}. Call \`.auth({ secret, ... })\` before \`.build()\`.`,
    );
  }
  // `origins: ["*"]` with `credentials: true` tells the browser every site may
  // make authenticated requests carrying a visitor's cookie — a CSRF-grade
  // hole. Browsers reject a literal wildcard alongside credentials, but this
  // middleware echoes the request origin back, which would sidestep that
  // safeguard. Refuse the combination rather than silently honor it.
  if (cors?.origins.includes("*") && cors.credentials) {
    throw new Error(
      'cors: `origins: ["*"]` cannot be combined with `credentials: true` — that would let any origin make authenticated requests with a visitor\'s cookies. List the trusted origins explicitly.',
    );
  }
  if (files) {
    const tables = schemas.at(-1)?.tables ?? {};
    if (!tables["file"]) {
      throw new Error(
        '`.files()` requires a `file` table — add `.files()` to your schema: `schema("1.0.0").auth().files()`.',
      );
    }
    if (!(files.storage ?? resources.storage)) {
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
}

/** Phase 3: mounts the H3 server with middleware and routes. */
function mountServer<TRouter extends Record<string, any>, TDB>(
  assembled: AssembledOuter<TRouter, TDB>,
): BuiltOuter<TRouter, TDB> {
  const {
    router,
    pendingRouter,
    migrator,
    typedDb,
    contextFactory,
    resources,
    latestSchema,
    pluginMiddleware,
    name,
  } = assembled;
  const { db, auth, cors, files } = resources;

  /**
   * Resolves the context once per request and memoizes it on the H3 event, so
   * a request that passes through the rate limiter (which needs `user`) and
   * then a handler doesn't pay for two Better Auth session lookups. The
   * promise is cached so concurrent awaits share the single resolution.
   */
  const contextFor = (event: H3Event): Promise<OuterRpcContext<TDB>> => {
    const store = event.context as { __outerContext?: Promise<OuterRpcContext<TDB>> };
    return (store.__outerContext ??= contextFactory(event.req.headers));
  };

  // ORPCError is an intentional application response (400/401/403/404/409, etc.) —
  // only surface genuinely unexpected failures, to avoid noisy/sensitive logs.
  const reportError =
    (source: ErrorSource) =>
    (error: unknown, request?: Request): void => {
      if (error instanceof ORPCError) return;
      const hook = resources.onError;
      if (hook) hook(error, { request: request ?? new Request("http://localhost"), source });
      else console.error(error);
    };

  const rpc = new RPCHandler(router, {
    interceptors: [onError((error) => reportError("rpc")(error))],
  });

  let server = new H3();

  if (cors) {
    server = server.use(createCorsMiddleware(cors));
  }

  // Reject oversized uploads from Content-Length, before the body is parsed
  // into memory — the per-file `maxBytes` check in `.files()` only runs after
  // oRPC has already buffered the whole multipart payload.
  if (files) {
    const maxBytes = files.maxBytes ?? 10 * 1024 * 1024;
    // Multipart adds boundaries and headers around the file itself.
    const envelope = 1024 * 100;
    server = server.use(async (event, next) => {
      const declared = Number(event.req.headers.get("content-length") ?? "0");
      if (declared > maxBytes + envelope) {
        const path = new URL(event.req.url).pathname;
        if (path.startsWith("/rpc") || path.startsWith("/rest")) {
          return new Response(
            JSON.stringify({ error: `Payload too large; the limit is ${maxBytes} bytes.` }),
            { status: 413, headers: { "content-type": "application/json" } },
          );
        }
      }
      return next();
    });
  }

  const rateLimit = resources.rateLimit;
  const rateLimitStore = rateLimit ? (rateLimit.store ?? memoryRateLimitStore()) : undefined;
  if (rateLimit && rateLimitStore) {
    server = server.use(createRateLimitMiddleware(rateLimit, rateLimitStore, contextFor as any));
  }

  // Plugin middleware runs after built-in middleware (CORS, rate-limit) but before routes.
  for (const mw of pluginMiddleware) {
    server = server.use(mw);
  }

  if (resources.openapiEnabled) {
    server = mountOpenApiRoutes({
      server,
      router,
      name,
      baseUrl: resources.baseUrl,
      version: latestSchema?.version,
      contextFor,
      reportError: reportError("rest"),
    });
  }

  const mcpConfig = resources.mcp;
  if (mcpConfig?.enabled) {
    server = mountMcpHandler({
      server,
      router,
      mcpConfig,
      name,
      version: latestSchema?.version,
      contextFor,
      reportError: reportError("mcp"),
    });
  }

  if (auth) {
    server = server.all("/api/auth/**", (event) => auth.handler(event.req));
  }

  for (const { method, path, handler } of resources.routes) {
    server = server.on(method, path, async (event) =>
      handler(event, (await contextFor(event)) as any),
    );
  }

  const health = resources.health ?? true;
  if (health !== false) {
    const healthPath = (typeof health === "object" && health.path) || "/health";
    server = server.get(healthPath, async () => {
      try {
        await sql`select 1`.execute(db);
        return { status: "ok", database: "up" };
      } catch (error) {
        reportError("route")(error);
        return new Response(JSON.stringify({ status: "error", database: "down" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
    });
  }

  server = server.all("/rpc/**", async (event) => {
    const { response } = await rpc.handle(event.req, {
      prefix: "/rpc",
      context: await contextFor(event),
    });
    return response;
  });

  return new BuiltOuter(
    server,
    typedDb,
    migrator,
    pendingRouter,
    auth,
    rateLimitStore,
    contextFactory,
  );
}

/**
 * When `baseUrl` is omitted outside production, default to localhost + PORT so
 * Better Auth and OpenAPI have a usable origin without boilerplate. Production
 * deployments must set `baseUrl` (or `.auth({ baseURL })`) explicitly.
 */
function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl !== undefined) return baseUrl;
  const env =
    typeof process !== "undefined"
      ? (process as { env?: Record<string, string | undefined> }).env
      : undefined;
  if (env?.["NODE_ENV"] === "production") return undefined;
  const port = env?.["PORT"] || "3000";
  return `http://localhost:${port}`;
}

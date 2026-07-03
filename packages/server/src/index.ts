import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { OpenAPIGenerator } from "@orpc/openapi";
import { os, onError, Router, Builder, AnyProcedure, Middleware } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { betterAuth, Auth, BetterAuthOptions } from "better-auth";
import { H3, H3Event, HTTPMethod } from "h3";
import { Dialect, Kysely, PGliteDialect } from "kysely";

import { createMigrator, DialectKind } from "./migrator";
import { buildResourceProcedures, ResourceOptions } from "./resource";
import { schema, SchemaResult, InferDB, TablesDef, ColumnDef } from "./schema";
import { createSola, Sola } from "./sola";

export { schema };
export type { ResourceOptions, DialectKind };

type OuterAuth = Auth<any>;
type OuterDB<TDB> = Kysely<TDB> & { query: Sola<TDB> };

export type OuterRpcContext<TDB = any> = {
  headers: Headers;
  db: OuterDB<TDB>;
  auth?: OuterAuth;
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
   * Defaults to an embedded PGlite instance (real Postgres, zero external
   * infra) writing to `dataDir`. To bring your own Kysely `Dialect` — e.g. a
   * network Postgres, or a `"sqlite"`-family dialect for Cloudflare D1 /
   * Durable Objects — pass `{ dialect, kind }` instead. `kind` drives DDL
   * generation, Better Auth's schema, and DB error mapping; it must match the
   * dialect you provide.
   */
  db?: { dataDir?: string } | { dialect: Dialect; kind: DialectKind };
};

type OuterRoute<TContext> = {
  method: HTTPMethod | Lowercase<HTTPMethod> | "";
  path: string;
  handler: (event: H3Event, context: TContext) => unknown;
};

type OuterResources = {
  dialect: Dialect;
  dialectKind: DialectKind;
  db: Kysely<any>;
  baseUrl: string | undefined;
  auth: OuterAuth | undefined;
  openapiEnabled: boolean;
  routes: OuterRoute<any>[];
};

export type OpenApiConfig = {
  /** Whether to mount `GET /openapi.json`. Defaults to `true` when `.openapi()` is called — pass `import.meta.env.DEV` or similar to gate it on dev/staging only. */
  enabled?: boolean;
};

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
> {
  private pendingRouter: TRouter;
  private readonly resources: OuterResources;
  private readonly pendingBase: Builder<TContext & object, Record<never, never>>;
  private readonly schemas: SchemaResult<any>[];
  private readonly name: string | undefined;

  constructor(params?: OuterParams);
  constructor(
    params: OuterParams,
    _resources: OuterResources,
    _base: Builder<TContext & object, Record<never, never>>,
    _router: TRouter,
    _schemas: SchemaResult<any>[],
  );
  constructor(
    params: OuterParams = {},
    _resources?: OuterResources,
    _base?: Builder<TContext & object, Record<never, never>>,
    _router?: TRouter,
    _schemas?: SchemaResult<any>[],
  ) {
    this.name = params.name;
    if (_resources && _base) {
      // Clone path: copy resources so mutations (e.g. .storage()) don't bleed across instances
      this.resources = { ..._resources };
      this.pendingBase = _base;
      this.pendingRouter = _router ?? ({} as TRouter);
      this.schemas = _schemas ?? [];
    } else {
      let dialect: Dialect;
      let dialectKind: DialectKind;
      if (params.db && "dialect" in params.db) {
        dialect = params.db.dialect;
        dialectKind = params.db.kind;
      } else {
        const dataDir = params.db?.dataDir ?? path.join(process.cwd(), ".outer", "pglite");
        if (!dataDir.startsWith("memory://")) {
          mkdirSync(dataDir, { recursive: true });
        }
        dialect = new PGliteDialect({ pglite: new PGlite({ dataDir }) });
        dialectKind = "postgres";
      }
      const db = new Kysely<any>({ dialect });
      this.resources = {
        dialect,
        dialectKind,
        db,
        baseUrl: params.baseUrl,
        auth: undefined,
        openapiEnabled: false,
        routes: [],
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

  /** Enables Better Auth and mounts `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain. Narrows `context.auth` to non-null. */
  auth(config: AuthConfig): Outer<TContext & { auth: OuterAuth }, TDB, TRouter> {
    this.resources.auth = betterAuth({
      baseURL: this.resources.baseUrl,
      ...config,
      database: { type: this.resources.dialectKind, dialect: this.resources.dialect },
    });
    return new Outer<TContext & { auth: OuterAuth }, TDB, TRouter>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase as unknown as Builder<
        (TContext & { auth: OuterAuth }) & object,
        Record<never, never>
      >,
      this.pendingRouter,
      this.schemas,
    );
  }

  schema<T extends TablesDef>(
    s: SchemaResult<T>,
  ): Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter> {
    return new Outer<OuterRpcContext<InferDB<T>>, InferDB<T>, TRouter>(
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
  ): Outer<TContext & TOutContext, TDB, TRouter> {
    return new Outer<TContext & TOutContext, TDB, TRouter>(
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

  procedure<TName extends string, TProc extends AnyProcedure>(
    name: TName,
    cb: (base: Builder<TContext & object, Record<never, never>>) => TProc,
  ): Outer<TContext, TDB, MergeRouters<TRouter, NestRoute<TName, TProc>>> {
    this.addToRouter(name, cb(this.pendingBase));
    return this as unknown as Outer<TContext, TDB, MergeRouters<TRouter, NestRoute<TName, TProc>>>;
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

  resource<TName extends keyof TDB & string>(
    name: TName,
    options?: ResourceOptions,
  ): Outer<
    TContext,
    TDB,
    MergeRouters<
      TRouter,
      NestRoute<TName, Record<"list" | "get" | "create" | "update" | "delete", AnyProcedure>>
    >
  > {
    const cols = this.schemas.at(-1)?.tables[name] as Record<string, ColumnDef> | undefined;
    if (!cols) throw new Error(`Table "${name}" not found in schema`);
    for (const [action, proc] of Object.entries(
      buildResourceProcedures(
        name,
        cols,
        this.pendingBase as any,
        options,
        this.resources.dialectKind,
      ),
    )) {
      this.addToRouter(`${name}.${action}`, proc);
    }
    return this as unknown as Outer<
      TContext,
      TDB,
      MergeRouters<
        TRouter,
        NestRoute<TName, Record<"list" | "get" | "create" | "update" | "delete", AnyProcedure>>
      >
    >;
  }

  /** The internal oRPC router — also available on `BuiltOuter` after `.build()`. Use `InferRouter<typeof instance>` for type-safe client generation. */
  get router(): TRouter {
    return this.pendingRouter;
  }

  build(): BuiltOuter<TRouter> {
    const { db, auth } = this.resources;

    const router: Router<OuterRpcContext<TDB>> = this.pendingRouter as unknown as Router<
      OuterRpcContext<TDB>
    >;

    const latestSchema = this.schemas.at(-1);
    const typedDb = Object.assign(db as Kysely<TDB>, {
      query: createSola<TDB>({
        db,
        tables: latestSchema?.tables ?? {},
        relations: latestSchema?.relations ?? [],
      }),
    }) as OuterDB<TDB>;

    const rpc = new RPCHandler(router, {
      interceptors: [
        onError((error) => {
          console.error(error);
        }),
      ],
    });

    let server = new H3();

    if (this.resources.openapiEnabled) {
      server = server.get("/openapi.json", async () => {
        const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
        return generator.generate(router, {
          base: {
            info: {
              title: this.name ?? "Outer API",
              version: latestSchema?.version ?? "0.0.0",
            },
          },
        });
      });
    }

    if (auth) {
      server = server.all("/api/auth/**", (event) => auth.handler(event.req));
    }

    for (const { method, path, handler } of this.resources.routes) {
      server = server.on(method, path, (event) =>
        handler(event, { headers: event.req.headers, db: typedDb, ...(auth && { auth }) } as any),
      );
    }

    server = server.all("/rpc/**", async (event) => {
      const { response } = await rpc.handle(event.req, {
        prefix: "/rpc",
        context: { headers: event.req.headers, db: typedDb, ...(auth && { auth }) },
      });
      return response;
    });

    return new BuiltOuter(server, db, this.schemas, this.pendingRouter, this.resources.dialectKind);
  }

  private addToRouter(dotName: string, proc: AnyProcedure): void {
    const nested = dotName
      .split(".")
      .reduceRight<Record<string, any> | AnyProcedure>((acc, key) => ({ [key]: acc }), proc);
    this.pendingRouter = deepMerge({
      a: this.pendingRouter as Record<string, any>,
      b: nested as Record<string, any>,
    }) as TRouter;
  }
}

export class BuiltOuter<TRouter extends Record<string, any> = Router<any>> {
  readonly migrator: ReturnType<typeof createMigrator>;
  readonly router: TRouter;
  private readonly server: H3;

  constructor(
    server: H3,
    db: Kysely<any>,
    schemas: SchemaResult<any>[],
    router: TRouter,
    dialectKind: DialectKind = "postgres",
  ) {
    this.server = server;
    this.migrator = createMigrator({ db, schemas, kind: dialectKind });
    this.router = router;
  }

  async handle(request: Request): Promise<Response> {
    return this.server.fetch(request);
  }
}

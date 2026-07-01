import { H3 } from "h3";
import { RPCHandler } from "@orpc/server/fetch";
import { os, onError, Router, Builder, AnyProcedure, Middleware } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { OpenAPIGenerator } from "@orpc/openapi";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { Kysely, PGliteDialect } from "kysely";
import { betterAuth, Auth, BetterAuthOptions } from "better-auth";
import { schema, SchemaResult, InferDB, TablesDef, ColumnDef } from "./schema";
import { createMigrator } from "./migrator";
import { createSola, Sola } from "./sola";
import { buildResourceProcedures, ResourceOptions } from "./resource";

export { schema };
export type { ResourceOptions };

type OuterAuth = Auth<any>;
type OuterDB<TDB> = Kysely<TDB> & { query: Sola<TDB> };

export type OuterRpcContext<TDB = any> = {
  headers: Headers;
  db: OuterDB<TDB>;
  auth?: OuterAuth;
};

export type AuthConfig = Omit<BetterAuthOptions, "database" | "baseURL"> & {
  /** Secret used by Better Auth to sign/encrypt sessions, cookies, and tokens. */
  secret: string;
};

export type OuterParams = {
  name?: string;
  baseUrl?: string;
  db?: { dataDir?: string };
};

type OuterResources = {
  dialect: PGliteDialect;
  db: Kysely<any>;
  baseUrl: string | undefined;
  auth: OuterAuth | undefined;
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

export class Outer<TContext extends OuterRpcContext<TDB> = OuterRpcContext, TDB = any> {
  private pendingRouter: Router<OuterRpcContext<TDB>>;
  private readonly resources: OuterResources;
  private readonly pendingBase: Builder<TContext & object, Record<never, never>>;
  private readonly schemas: SchemaResult<any>[];
  private readonly name: string | undefined;

  constructor(params?: OuterParams);
  constructor(
    params: OuterParams,
    _resources: OuterResources,
    _base: Builder<TContext & object, Record<never, never>>,
    _router: Router<OuterRpcContext<TDB>>,
    _schemas: SchemaResult<any>[],
  );
  constructor(
    params: OuterParams = {},
    _resources?: OuterResources,
    _base?: Builder<TContext & object, Record<never, never>>,
    _router?: Router<OuterRpcContext<TDB>>,
    _schemas?: SchemaResult<any>[],
  ) {
    this.name = params.name;
    if (_resources && _base) {
      // Clone path: copy resources so mutations (e.g. .storage()) don't bleed across instances
      this.resources = { ..._resources };
      this.pendingBase = _base;
      this.pendingRouter = _router ?? {};
      this.schemas = _schemas ?? [];
    } else {
      const dataDir = params.db?.dataDir ?? path.join(process.cwd(), ".outer", "pglite");
      if (!dataDir.startsWith("memory://")) {
        mkdirSync(dataDir, { recursive: true });
      }
      const dialect = new PGliteDialect({ pglite: new PGlite({ dataDir }) });
      const db = new Kysely<any>({ dialect });
      this.resources = { dialect, db, baseUrl: params.baseUrl, auth: undefined };
      this.pendingBase = os.$context<OuterRpcContext>() as unknown as Builder<
        TContext & object,
        Record<never, never>
      >;
      this.pendingRouter = {};
      this.schemas = [];
    }
  }

  /** Enables Better Auth and mounts `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain. Narrows `context.auth` to non-null. */
  auth(config: AuthConfig): Outer<TContext & { auth: OuterAuth }, TDB> {
    this.resources.auth = betterAuth({
      ...config,
      baseURL: this.resources.baseUrl,
      database: { type: "postgres" as const, dialect: this.resources.dialect },
    });
    return new Outer<TContext & { auth: OuterAuth }, TDB>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase as unknown as Builder<
        (TContext & { auth: OuterAuth }) & object,
        Record<never, never>
      >,
      this.pendingRouter as unknown as Router<OuterRpcContext<TDB>>,
      this.schemas,
    );
  }

  schema<T extends TablesDef>(s: SchemaResult<T>): Outer<OuterRpcContext<InferDB<T>>, InferDB<T>> {
    return new Outer<OuterRpcContext<InferDB<T>>, InferDB<T>>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      os.$context<OuterRpcContext<InferDB<T>>>() as unknown as Builder<
        OuterRpcContext<InferDB<T>> & object,
        Record<never, never>
      >,
      this.pendingRouter as unknown as Router<OuterRpcContext<InferDB<T>>>,
      [...this.schemas, s],
    );
  }

  middleware<TOutContext extends Record<string, unknown>>(
    mw: Middleware<TContext & object, TOutContext, unknown, unknown, Record<never, never>>,
  ): Outer<TContext & TOutContext, TDB> {
    return new Outer<TContext & TOutContext, TDB>(
      { ...(this.name && { name: this.name }) },
      this.resources,
      this.pendingBase.use(mw as any) as unknown as Builder<
        TContext & TOutContext & object,
        Record<never, never>
      >,
      this.pendingRouter as unknown as Router<OuterRpcContext<TDB>>,
      this.schemas,
    );
  }

  procedure(
    name: string,
    cb: (base: Builder<TContext & object, Record<never, never>>) => AnyProcedure,
  ): this {
    this.addToRouter(name, cb(this.pendingBase));
    return this;
  }

  resource(name: keyof TDB & string, options?: ResourceOptions): this {
    const cols = this.schemas.at(-1)?.tables[name] as Record<string, ColumnDef> | undefined;
    if (!cols) throw new Error(`Table "${name}" not found in schema`);
    for (const [action, proc] of Object.entries(
      buildResourceProcedures(name, cols, this.pendingBase as any, options),
    )) {
      this.addToRouter(`${name}.${action}`, proc);
    }
    return this;
  }

  /** The internal oRPC router — use `typeof instance.router` for type-safe client generation. */
  get router(): Router<OuterRpcContext<TDB>> {
    return this.pendingRouter;
  }

  build(): BuiltOuter {
    const { db, auth } = this.resources;

    const router: Router<OuterRpcContext<TDB>> = this.pendingRouter;

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

    let server = new H3()
      .get("/openapi.json", async () => {
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

    if (auth) {
      server = server.all("/api/auth/**", (event) => auth.handler(event.req));
    }

    server = server.all("/rpc/**", async (event) => {
      const { response } = await rpc.handle(event.req, {
        prefix: "/rpc",
        context: { headers: event.req.headers, db: typedDb, ...(auth && { auth }) },
      });
      return response;
    });

    return new BuiltOuter(server, db, this.schemas);
  }

  private addToRouter(dotName: string, proc: AnyProcedure): void {
    const nested = dotName
      .split(".")
      .reduceRight<Router<OuterRpcContext<TDB>> | AnyProcedure>(
        (acc, key) => ({ [key]: acc }),
        proc,
      );
    this.pendingRouter = deepMerge({
      a: this.pendingRouter,
      b: nested as Router<OuterRpcContext<TDB>>,
    });
  }
}

export class BuiltOuter {
  readonly migrator: ReturnType<typeof createMigrator>;
  private readonly server: H3;

  constructor(server: H3, db: Kysely<any>, schemas: SchemaResult<any>[]) {
    this.server = server;
    this.migrator = createMigrator({ db, schemas });
  }

  async handle(request: Request): Promise<Response> {
    return this.server.fetch(request);
  }
}

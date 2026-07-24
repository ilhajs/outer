import { createRouterClient, type Router, type RouterClient } from "@orpc/server";
import type { H3 } from "h3";

import { createContextFactory } from "./context";
import { createMigrator } from "./migrator";
import type { ErrorSourcesOf, OuterAuth, OuterDB, OuterRpcContext, RateLimitStore } from "./types";

export class BuiltOuter<
  TRouter extends Record<string, any> = Router<any>,
  TDB = any,
  TOpenApi extends boolean = boolean,
  TMcp extends boolean = boolean,
> {
  readonly migrator: ReturnType<typeof createMigrator>;
  readonly router: TRouter;
  /** The same `db` handed to procedures (Kysely + `query` + `transact`) — use it for out-of-band work like seeding after migrations. */
  readonly db: OuterDB<TDB>;
  /**
   * Error sources this instance can emit to `onError`. `rest` requires
   * `.openapi()`; `mcp` requires `.mcp()`.
   */
  readonly errorSources!: ErrorSourcesOf<TOpenApi, TMcp>;
  private readonly server: H3;
  private readonly auth: OuterAuth | undefined;
  private readonly rateLimitStore: RateLimitStore | undefined;
  private readonly contextFactory: (headers: Headers) => Promise<OuterRpcContext<TDB>>;
  private closed = false;

  constructor(
    server: H3,
    db: OuterDB<TDB>,
    migrator: ReturnType<typeof createMigrator>,
    router: TRouter,
    auth?: OuterAuth,
    rateLimitStore?: RateLimitStore,
    contextFactory?: (headers: Headers) => Promise<OuterRpcContext<TDB>>,
  ) {
    this.server = server;
    this.db = db;
    this.auth = auth;
    this.migrator = migrator;
    this.router = router;
    this.rateLimitStore = rateLimitStore;
    // Prefer the factory from assemble/mount so client() and HTTP share one path.
    // Fallback keeps direct BuiltOuter construction working (db + auth only).
    this.contextFactory =
      contextFactory ??
      createContextFactory<TDB>({
        typedDb: db,
        auth: this.auth,
        storage: undefined,
        secrets: undefined,
        kv: undefined,
      });
  }

  /**
   * Releases the database pool (and the embedded PGlite instance with it) plus
   * any rate-limit timers. Call it from your `SIGTERM`/`SIGINT` handler, and in
   * tests that build more than one instance — otherwise connections leak.
   *
   * Safe to call more than once; the instance must not be used afterwards.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rateLimitStore?.dispose?.();
    await this.db.destroy();
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
   *
   * Session resolution reuses the same context factory as the HTTP path.
   */
  client(
    headers: Headers | (() => Headers | Promise<Headers>) = new Headers(),
  ): RouterClient<TRouter> {
    return createRouterClient(this.router as Router<OuterRpcContext>, {
      context: async (): Promise<OuterRpcContext> => {
        const resolvedHeaders = typeof headers === "function" ? await headers() : headers;
        return this.contextFactory(resolvedHeaders) as Promise<OuterRpcContext>;
      },
    }) as RouterClient<TRouter>;
  }
}

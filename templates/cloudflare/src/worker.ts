import { Outer, type InferRouter } from "@outerjs/server";
import { DurableObject } from "cloudflare:workers";
import { DurableObjectSqliteDialect } from "kysely-durable-objects";
import { z } from "zod";

import { v1_0_0 } from "./schema";

// one DO instance (see idFromName below) = one SQLite DB, like PGlite's local file
export class OuterDO extends DurableObject<Env> {
  readonly outer;
  private readonly ready: Promise<unknown>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.outer = new Outer({
      name: "Outer",
      db: {
        dialect: new DurableObjectSqliteDialect(ctx.storage.sql as any),
        kind: "sqlite",
      },
    })
      .schema(v1_0_0)
      .auth({
        // set AUTH_SECRET via `wrangler secret put` in production
        secret: env.AUTH_SECRET ?? "dev-only-secret",
        emailAndPassword: { enabled: true },
      })
      .openapi()
      .admin()
      .resource("post")
      .procedure("post.count", (base) =>
        base.output(z.object({ count: z.number() })).handler(async ({ context }) => {
          const rows = await context.db
            .selectFrom("post")
            .select(context.db.fn.countAll().as("count"))
            .execute();
          return { count: Number(rows[0]?.count ?? 0) };
        }),
      )
      .build();

    this.ready = ctx.blockConcurrencyWhile(async () => {
      const { error } = await this.outer.migrator.migrateToLatest();
      if (error) console.error(error);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    return this.outer.handle(request);
  }
}

export type Router = InferRouter<OuterDO["outer"]>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // swap for idFromName(orgId) etc for per-tenant DBs
    const id = env.OUTER_DO.idFromName("singleton");
    const stub = env.OUTER_DO.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

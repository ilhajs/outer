import { Outer, type InferRouter } from "@outerjs/server";
import { DurableObject } from "cloudflare:workers";
import { DurableObjectSqliteDialect } from "kysely-durable-objects";
import { z } from "zod";

import { v1_0_0 } from "./schema";

/**
 * All state lives in this Durable Object's own SQLite storage
 * (`ctx.storage.sql`) — there's exactly one instance per `idFromName`, so
 * routing every request at the same name (see the default export below)
 * gives a single globally consistent DB, the DO equivalent of PGlite's
 * local-disk file.
 */
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
      .openapi()
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

    // Migrations must finish before the first request is served, and
    // blockConcurrencyWhile guarantees no other request interleaves with it.
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
    // A fixed name routes every request at the same DO instance — swap this
    // for per-tenant routing (e.g. idFromName(orgId)) if you need isolated
    // databases per customer instead of one shared one.
    const id = env.OUTER_DO.idFromName("singleton");
    const stub = env.OUTER_DO.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

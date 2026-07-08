import { neon } from "@neondatabase/serverless";
import { Outer, schema, type InferRouter, timestamps } from "@outerjs/server";
import { NeonDialect } from "kysely-neon";
import { z } from "zod";

const v1_0_0 = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  .build();

const outer = new Outer({
  name: "Outer",
  db: {
    dialect: new NeonDialect({ neon: neon(process.env["DATABASE_URL"]!) }),
    kind: "postgres", // Neon is real Postgres
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

export type Router = InferRouter<typeof outer>;

// reused by scripts/migrate.ts — migrations run there, not per-request (see README)
export { outer };

// must be a named `fetch` export, not `export default` — see README
export async function fetch(request: Request): Promise<Response> {
  return outer.handle(request);
}

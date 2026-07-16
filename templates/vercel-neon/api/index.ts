import { neon } from "@neondatabase/serverless";
import { Outer, schema, type InferRouter, timestamps } from "@outerjs/server";
import { NeonDialect } from "kysely-neon";
import { z } from "zod";

// TODO: Set DATABASE_URL and AUTH_SECRET in your Vercel project env — the AUTH_SECRET fallback is for local development only
const env = z
  .object({
    DATABASE_URL: z.string(),
    BASE_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().default("dev-only-secret"),
  })
  .parse(process.env);

const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  .build();

const outer = new Outer({
  name: "Outer",
  baseUrl: env.BASE_URL,
  db: {
    dialect: new NeonDialect({ neon: neon(env.DATABASE_URL) }),
    kind: "postgres", // Neon is real Postgres
  },
})
  .schema(v1_0_0)
  .auth({
    secret: env.AUTH_SECRET,
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

export type Router = InferRouter<typeof outer>;

// reused by scripts/migrate.ts — migrations run there, not per-request (see README)
export { outer };

// must be a named `fetch` export, not `export default` — see README
export async function fetch(request: Request): Promise<Response> {
  return outer.handle(request);
}

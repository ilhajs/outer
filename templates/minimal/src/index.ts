import { Outer, type InferRouter } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { serve } from "srvx";
import { z } from "zod";

import { v1_0_0 } from "./schema";

// TODO: Copy .env.example to .env and set AUTH_SECRET in production
const env = z
  .object({
    PORT: z.coerce.number().default(3000),
    BASE_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().default("dev-only-secret"),
  })
  .parse(process.env);

const outer = new Outer({ name: "Outer", db: pglite(), baseUrl: env.BASE_URL })
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

const { error, results } = await outer.migrator.migrateToLatest();

if (error) {
  console.error(error);
} else {
  console.info(
    results?.length
      ? `[Outer] ${results.length} migrations applied`
      : "[Outer] No migrations to apply",
  );
}

export type Router = InferRouter<typeof outer>;

// swap for Bun.serve/Deno.serve/etc — outer.handle is a plain Fetch handler
serve({
  fetch: (req) => outer.handle(req),
  port: env.PORT,
});

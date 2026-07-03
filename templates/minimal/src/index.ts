import { Outer, type InferRouter } from "@outerjs/server";
import { serve } from "srvx";
import { z } from "zod";

import { v1_0_0 } from "./schema";

const outer = new Outer({ name: "Outer" })
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
  port: Number(process.env["PORT"] ?? 3000),
});

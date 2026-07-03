import { neon } from "@neondatabase/serverless";
import { Outer, type InferRouter } from "@outerjs/server";
import { NeonDialect } from "kysely-neon";
import { z } from "zod";

import { v1_0_0 } from "./schema";

const outer = new Outer({
  name: "Outer",
  db: {
    dialect: new NeonDialect({ neon: neon(process.env["DATABASE_URL"]!) }),
    kind: "postgres", // Neon is real Postgres — same DDL/error mapping as the default PGlite dialect
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

// Runs once per cold start (top-level await, same pattern as templates/ilha's
// server.ts) rather than per-request — migrations are idempotent, but there's
// no reason to re-check them on every warm invocation.
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

export default outer;

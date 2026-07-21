import { schema, timestamps } from "@outerjs/server";

export const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  // Adds the `file` metadata table plus a `post_file` pivot. Only metadata lives in
  // the Durable Object's SQLite — the bytes go to R2 (see `storage` in worker.ts).
  .files({ attachTo: ["post"] })
  .build();

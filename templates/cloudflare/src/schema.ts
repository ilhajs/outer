import { schema, timestamps } from "@outerjs/server";

export const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  .build();

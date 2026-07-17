import { schema, timestamps } from "@outerjs/server";

export const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    content: t.text().nullable(),
    userId: t.text().references("user", "id"),
    ...timestamps(t),
  }))
  .relation("user", (rel) => rel.hasMany("post", { from: "id", to: "userId" }))
  .relation("post", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

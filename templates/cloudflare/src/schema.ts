import { schema, timestamps } from "@outerjs/server/schema";

export const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  // The roles this app recognises. A user may hold several at once — Better
  // Auth stores them comma-separated in the single `role` column, so
  // "admin,support" is valid while "admin,root" is rejected. Omit `roles` to
  // accept any name.
  .auth({ roles: ["user", "admin"] })
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    content: t.text().nullable(),
    // cascade: deleting a user removes their posts rather than failing on the FK
    userId: t.text().references("user", "id", { onDelete: "cascade" }).index(),
    ...timestamps(t),
  }))
  // Adds the `file` metadata table plus a `post_file` pivot, so files can be
  // attached to posts. The bytes live in the storage passed to `new Outer(...)`.
  .files({ attachTo: ["post"] })
  .relation("user", (rel) => rel.hasMany("post", { from: "id", to: "userId" }))
  .relation("post", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

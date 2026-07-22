import { schema, timestamps } from "@outerjs/server/schema";

export const v1_0_0 = schema("1.0.0")
  .auth()
  .table("todo", (t) => ({
    id: t.text().primaryKey(),
    title: t.text(),
    description: t.text().nullable(),
    completed: t.boolean().default(false),
    userId: t.text().references("user", "id"),
    ...timestamps(t),
  }))
  // Adds the `file` metadata table plus a `todo_file` pivot, so files can be
  // attached to todos. The bytes live in unstorage — see `storage` in server.ts.
  .files({ attachTo: ["todo"] })
  .relation("user", (rel) => rel.hasMany("todo", { from: "id", to: "userId" }))
  .relation("todo", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

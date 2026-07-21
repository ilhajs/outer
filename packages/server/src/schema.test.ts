import { test, describe, expect } from "bun:test";

import { parseSet, schema, timestamps, toSet } from "./schema";

describe("schema builder", () => {
  test("build() returns version, tables, and relations", () => {
    const s = schema("1.0.0")
      .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
      .build();

    expect(s.version).toBe("1.0.0");
    expect("post" in s.tables).toBe(true);
    expect(s.relations).toEqual([]);
  });

  test("build() result is frozen", () => {
    const s = schema("1.0.0").build();
    expect(Object.isFrozen(s)).toBe(true);
  });

  test("multiple .table() calls accumulate", () => {
    const s = schema("1.0.0")
      .table("a", (t) => ({ id: t.text().primaryKey() }))
      .table("b", (t) => ({ id: t.text().primaryKey() }))
      .build();
    expect("a" in s.tables).toBe(true);
    expect("b" in s.tables).toBe(true);
  });

  test("column modifiers are recorded", () => {
    const s = schema("1.0.0")
      .table("item", (t) => ({
        id: t.serial().primaryKey(),
        slug: t.text().unique(),
        label: t.text().nullable(),
        score: t.integer().default(0),
        ref: t.text().references("other", "id"),
      }))
      .build();

    const cols = s.tables["item"]!;
    expect(cols["id"]!._type).toBe("serial");
    expect(cols["id"]!._primaryKey).toBe(true);
    expect(cols["slug"]!._unique).toBe(true);
    expect(cols["label"]!._nullable).toBe(true);
    expect(cols["score"]!._default).toEqual({ kind: "value", value: 0 });
    expect(cols["ref"]!._references).toEqual({ table: "other", column: "id" });
  });

  test("all column types are constructable", () => {
    const s = schema("1.0.0")
      .table("types", (t) => ({
        a: t.text(),
        b: t.varchar(),
        c: t.integer(),
        d: t.serial(),
        e: t.boolean(),
        f: t.timestamp(),
        g: t.jsonb(),
        h: t.uuid(),
      }))
      .build();

    const cols = s.tables["types"]!;
    expect(cols["a"]!._type).toBe("text");
    expect(cols["b"]!._type).toBe("varchar");
    expect(cols["c"]!._type).toBe("integer");
    expect(cols["d"]!._type).toBe("serial");
    expect(cols["e"]!._type).toBe("boolean");
    expect(cols["f"]!._type).toBe("timestamp");
    expect(cols["g"]!._type).toBe("jsonb");
    expect(cols["h"]!._type).toBe("uuid");
  });

  test("relations are recorded with correct kind and columns", () => {
    const s = schema("1.0.0")
      .table("user", (t) => ({ id: t.text().primaryKey() }))
      .table("post", (t) => ({ id: t.text().primaryKey(), authorId: t.text() }))
      .table("tag", (t) => ({ id: t.text().primaryKey() }))
      .table("post_tag", (t) => ({ postId: t.text(), tagId: t.text() }))
      .relation("user", (rel) => rel.hasMany("post", { from: "id", to: "authorId" }))
      .relation("post", (rel) => rel.belongsTo("user", { from: "authorId", to: "id" }))
      .relation("post", (rel) =>
        rel.manyToMany("tag", "post_tag", {
          from: "id",
          to: "id",
          pivotFrom: "postId",
          pivotTo: "tagId",
        }),
      )
      .relation("user", (rel) => rel.hasOne("post", { from: "id", to: "authorId" }))
      .build();

    expect(s.relations).toHaveLength(4);

    const hasMany = s.relations.find((r) => r.kind === "hasMany")!;
    expect(hasMany.fromTable).toBe("user");
    expect(hasMany.toTable).toBe("post");
    expect(hasMany.fromCol).toBe("id");
    expect(hasMany.toCol).toBe("authorId");

    const m2m = s.relations.find((r) => r.kind === "manyToMany")!;
    expect(m2m.pivotTable).toBe("post_tag");

    const hasOne = s.relations.find((r) => r.kind === "hasOne")!;
    expect(hasOne.fromTable).toBe("user");
  });

  test("non-nullable columns have _nullable: false by default", () => {
    const s = schema("1.0.0")
      .table("t", (t) => ({ name: t.text() }))
      .build();
    expect(s.tables["t"]!["name"]!._nullable).toBe(false);
  });

  test("nullable() flips _nullable to true", () => {
    const s = schema("1.0.0")
      .table("t", (t) => ({ bio: t.text().nullable() }))
      .build();
    expect(s.tables["t"]!["bio"]!._nullable).toBe(true);
  });

  test(".auth() registers the Better Auth tables with admin plugin fields", () => {
    const s = schema("1.0.0").auth().build();

    expect(Object.keys(s.tables).sort()).toEqual(["account", "session", "user", "verification"]);

    const user = s.tables["user"]!;
    expect(user["id"]!._primaryKey).toBe(true);
    expect(user["email"]!._unique).toBe(true);
    expect(user["role"]!._default).toEqual({ kind: "value", value: "user" });
    expect(user["banned"]!._default).toEqual({ kind: "value", value: false });
    expect(user["banReason"]!._nullable).toBe(true);
    expect(user["banExpires"]!._nullable).toBe(true);
    expect(user["createdAt"]!._default).toEqual({ kind: "sql", sql: "CURRENT_TIMESTAMP" });

    const session = s.tables["session"]!;
    expect(session["token"]!._unique).toBe(true);
    // cascade so deleting a user is not blocked by their sessions
    expect(session["userId"]!._references).toEqual({
      table: "user",
      column: "id",
      onDelete: "cascade",
    });
    expect(session["userId"]!._index).toBe(true);
    expect(session["impersonatedBy"]!._nullable).toBe(true);

    expect(s.tables["account"]!["password"]!._nullable).toBe(true);
    expect(s.tables["verification"]!["identifier"]!._type).toBe("text");

    expect(s.relations).toContainEqual(
      expect.objectContaining({ kind: "hasMany", fromTable: "user", toTable: "session" }),
    );
    expect(s.relations).toContainEqual(
      expect.objectContaining({ kind: "belongsTo", fromTable: "account", toTable: "user" }),
    );
    expect(s.relations).toHaveLength(4);
  });

  test(".auth() tables can be extended by re-declaring with extra columns", () => {
    const s = schema("1.0.0")
      .auth()
      .table("user", (t) => ({ plan: t.text().default("free") }))
      .build();

    const user = s.tables["user"]!;
    expect(user["plan"]!._default).toEqual({ kind: "value", value: "free" });
    expect(user["email"]!._unique).toBe(true); // auth columns survive the merge
  });

  test("timestamps(t) adds createdAt and updatedAt", () => {
    const s = schema("1.0.0")
      .table("todo", (t) => ({
        id: t.text().primaryKey(),
        title: t.text(),
        description: t.text().nullable(),
        userId: t.text().references("user", "id"),
        ...timestamps(t),
      }))
      .build();

    const cols = s.tables["todo"]!;
    expect(cols["id"]!._primaryKey).toBe(true);
    expect(cols["createdAt"]!._type).toBe("timestamp");
    expect(cols["createdAt"]!._default).toEqual({ kind: "sql", sql: "CURRENT_TIMESTAMP" });
    expect(cols["updatedAt"]!._type).toBe("timestamp");
    expect(cols["updatedAt"]!._default).toEqual({ kind: "sql", sql: "CURRENT_TIMESTAMP" });
  });

  test("enum() records allowed values and keeps the column text", () => {
    const built = schema("1.0.0")
      .table("member", (t) => ({
        id: t.serial().primaryKey(),
        role: t.text().enum(["user", "admin"]).default("user"),
      }))
      .build();
    const role = built.tables["member"]!["role"]!;
    expect(role._type).toBe("text");
    expect(role._enum).toEqual(["user", "admin"]);
    // chaining after enum() must not drop the value list
    expect(role._default).toEqual({ kind: "value", value: "user" });
  });

  test("enum() rejects non-text columns and empty lists", () => {
    expect(() =>
      schema("1.0.0")
        .table("x", (t) => ({ n: t.integer().enum(["a"]) }))
        .build(),
    ).toThrow(/only supported on text\/varchar/);
    expect(() =>
      schema("1.0.0")
        // an empty list yields `Values = never`, which is meaningless as a type —
        // the point of the test is that it throws before that ever matters
        .table("x", (t) => ({ n: t.text().enum([]) as never }))
        .build(),
    ).toThrow(/at least one value/);
  });

  test("auth() leaves user.role unconstrained (Better Auth allows custom/multi roles)", () => {
    const built = schema("1.0.0").auth().build();
    expect(built.tables["user"]!["role"]!._enum).toBeNull();
  });

  test("auth({ roles }) constrains user.role and keeps its default", () => {
    const built = schema("1.0.0")
      .auth({ roles: ["user", "admin"] })
      .build();
    const role = built.tables["user"]!["role"]!;
    expect(role._enum).toEqual(["user", "admin"]);
    expect(role._type).toBe("text");
    expect(role._default).toEqual({ kind: "value", value: "user" });
  });

  test("an app can constrain user.role by re-declaring the column", () => {
    const built = schema("1.0.0")
      .auth()
      .table("user", (t) => ({ role: t.text().enum(["user", "admin"]).default("user") }))
      .build();
    expect(built.tables["user"]!["role"]!._enum).toEqual(["user", "admin"]);
    expect(built.tables["user"]!["email"]!._unique).toBe(true); // merge kept auth columns
  });

  test("parseSet/toSet round-trip a multi-value column", () => {
    expect(parseSet("admin,support")).toEqual(["admin", "support"]);
    expect(parseSet(" admin , support ")).toEqual(["admin", "support"]); // tolerates spacing
    expect(parseSet("")).toEqual([]);
    expect(parseSet(null)).toEqual([]);
    expect(toSet(["admin", "support"])).toBe("admin,support");
    expect(parseSet(toSet(["a", "b"]))).toEqual(["a", "b"]);
  });
});

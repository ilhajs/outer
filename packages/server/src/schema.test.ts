import { test, describe, expect } from "bun:test";
import { schema } from "./schema";

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
        id:    t.serial().primaryKey(),
        slug:  t.text().unique(),
        label: t.text().nullable(),
        score: t.integer().default("0"),
        ref:   t.text().references("other", "id"),
      }))
      .build();

    const cols = s.tables["item"]!;
    expect(cols["id"]!._type).toBe("serial");
    expect(cols["id"]!._primaryKey).toBe(true);
    expect(cols["slug"]!._unique).toBe(true);
    expect(cols["label"]!._nullable).toBe(true);
    expect(cols["score"]!._default).toBe("0");
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
      .table("user",     (t) => ({ id: t.text().primaryKey() }))
      .table("post",     (t) => ({ id: t.text().primaryKey(), authorId: t.text() }))
      .table("tag",      (t) => ({ id: t.text().primaryKey() }))
      .table("post_tag", (t) => ({ postId: t.text(), tagId: t.text() }))
      .relation("user", (rel) => rel.hasMany("post",    { from: "id", to: "authorId" }))
      .relation("post", (rel) => rel.belongsTo("user",  { from: "authorId", to: "id" }))
      .relation("post", (rel) => rel.manyToMany("tag", "post_tag", { from: "id", to: "id", pivotFrom: "postId", pivotTo: "tagId" }))
      .relation("user", (rel) => rel.hasOne("post",     { from: "id", to: "authorId" }))
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
});

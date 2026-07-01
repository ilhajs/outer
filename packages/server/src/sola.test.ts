import { test, describe, beforeAll, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { schema } from "./schema";
import { createMigrator } from "./migrator";
import { createSola } from "./sola";

// ── Shared setup ──────────────────────────────────────────────────────────

const dbSchema = schema("1.0.0")
  .table("author", (t) => ({
    id:    t.serial().primaryKey(),
    name:  t.text(),
    email: t.text().unique(),
  }))
  .table("post", (t) => ({
    id:       t.serial().primaryKey(),
    title:    t.text(),
    body:     t.text().nullable(),
    authorId: t.integer().references("author", "id"),
  }))
  .table("tag", (t) => ({
    id:   t.serial().primaryKey(),
    name: t.text(),
  }))
  .table("post_tag", (t) => ({
    postId: t.integer().references("post", "id"),
    tagId:  t.integer().references("tag", "id"),
  }))
  .relation("author", (rel) => rel.hasMany("post",    { from: "id", to: "authorId" }))
  .relation("post",   (rel) => rel.belongsTo("author", { from: "authorId", to: "id" }))
  .relation("post",   (rel) => rel.manyToMany("tag", "post_tag", { from: "id", to: "id", pivotFrom: "postId", pivotTo: "tagId" }))
  .build();

type DB = typeof dbSchema._db;

async function makeFixture() {
  const dialect = new PGliteDialect({ pglite: new PGlite() });
  const db = new Kysely<DB>({ dialect });
  await createMigrator({ db, schemas: [dbSchema] }).migrateToLatest();
  const query = createSola<DB>({ db, tables: dbSchema.tables, relations: dbSchema.relations });
  return { db, query };
}

// ── findMany / findFirst / findUnique ─────────────────────────────────────

describe("sola — findMany / findFirst / findUnique", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createSola<DB>>;

  beforeAll(async () => {
    ({ db, query } = await makeFixture());
    await db.insertInto("author").values([
      { name: "Alice", email: "alice@x.com" },
      { name: "Bob",   email: "bob@x.com" },
    ] as any).execute();
  });

  test("findMany returns all rows", async () => {
    expect(await query.author.findMany()).toHaveLength(2);
  });

  test("findFirst returns matching row", async () => {
    const row = await query.author.findFirst({ where: { name: "Alice" } });
    expect(row?.name).toBe("Alice");
  });

  test("findFirst returns null when not found", async () => {
    expect(await query.author.findFirst({ where: { name: "Nobody" } })).toBeNull();
  });

  test("findUnique returns the row", async () => {
    const row = await query.author.findUnique({ where: { email: "alice@x.com" } });
    expect(row.name).toBe("Alice");
  });

  test("findUnique throws when not found", async () => {
    await expect(query.author.findUnique({ where: { email: "ghost@x.com" } })).rejects.toThrow();
  });

  test("orderBy and take/skip", async () => {
    const rows = await query.author.findMany({ orderBy: [{ name: "asc" }], take: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });
});

// ── count / exists ────────────────────────────────────────────────────────

describe("sola — count / exists", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createSola<DB>>;

  beforeAll(async () => {
    ({ db, query } = await makeFixture());
    await db.insertInto("author").values([
      { name: "Alice", email: "alice@x.com" },
      { name: "Bob",   email: "bob@x.com" },
    ] as any).execute();
  });

  test("count with no filter", async () => {
    expect(await query.author.count()).toBe(2);
  });

  test("count with where", async () => {
    expect(await query.author.count({ where: { name: "Alice" } })).toBe(1);
  });

  test("exists returns true when found", async () => {
    expect(await query.author.exists({ where: { name: "Bob" } })).toBe(true);
  });

  test("exists returns false when not found", async () => {
    expect(await query.author.exists({ where: { name: "Ghost" } })).toBe(false);
  });
});

// ── where operators ────────────────────────────────────────────────────────

describe("sola — where operators", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createSola<DB>>;

  beforeAll(async () => {
    ({ db, query } = await makeFixture());
    await db.insertInto("author").values([
      { name: "Alice", email: "alice@acme.com" },
      { name: "Bob",   email: "bob@other.com" },
      { name: "Carol", email: "carol@acme.com" },
    ] as any).execute();
  });

  const find = (where: any) => query.author.findMany({ where });

  test("direct value shorthand (equals)", async () => {
    expect(await find({ name: "Alice" })).toHaveLength(1);
  });

  test("equals operator", async () => {
    expect(await find({ name: { equals: "Bob" } })).toHaveLength(1);
  });

  test("not operator", async () => {
    const rows = await find({ name: { not: "Alice" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.name !== "Alice")).toBe(true);
  });

  test("in operator", async () => {
    expect(await find({ name: { in: ["Alice", "Bob"] } })).toHaveLength(2);
  });

  test("notIn operator", async () => {
    const rows = await find({ name: { notIn: ["Alice", "Bob"] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Carol");
  });

  test("contains operator", async () => {
    expect(await find({ email: { contains: "acme.com" } })).toHaveLength(2);
  });

  test("startsWith operator", async () => {
    expect(await find({ email: { startsWith: "alice" } })).toHaveLength(1);
  });

  test("endsWith operator", async () => {
    const rows = await find({ email: { endsWith: "other.com" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Bob");
  });

  test("OR logical", async () => {
    expect(await find({ OR: [{ name: "Alice" }, { name: "Bob" }] })).toHaveLength(2);
  });

  test("AND explicit array", async () => {
    expect(await find({ AND: [{ name: "Alice" }, { email: { contains: "acme" } }] })).toHaveLength(1);
  });

  test("NOT — fixed: was calling nonexistent qb.not()", async () => {
    const rows = await find({ NOT: { email: { contains: "acme.com" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Bob");
  });

  test("OR with nested field filter operator", async () => {
    const rows = await find({ OR: [
      { email: { contains: "acme.com" } },
      { name: { equals: "Bob" } },
    ]});
    expect(rows).toHaveLength(3);
  });

  test("isNull / isNull:false on nullable column", async () => {
    const [a] = await db.insertInto("author").values({ name: "IsNullTest", email: "isnull@t.com" } as any).returningAll().execute();
    const authorId = (a as any).id as number;
    await db.insertInto("post").values({ title: "P1", authorId, body: null } as any).execute();
    await db.insertInto("post").values({ title: "P2", authorId, body: "text" } as any).execute();
    expect(await query.post.findMany({ where: { authorId, body: { isNull: true } } })).toHaveLength(1);
    expect(await query.post.findMany({ where: { authorId, body: { isNull: false } } })).toHaveLength(1);
  });
});

// ── paginate ──────────────────────────────────────────────────────────────

describe("sola — paginate", () => {
  let query: ReturnType<typeof createSola<DB>>;

  beforeAll(async () => {
    const fix = await makeFixture();
    query = fix.query;
    for (let i = 1; i <= 10; i++) {
      await fix.db.insertInto("author").values({ name: `Author ${i}`, email: `a${i}@x.com` } as any).execute();
    }
  });

  test("offset: first page", async () => {
    const r = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 3, skip: 0 });
    expect(r.data).toHaveLength(3);
    expect(r.pagination.count).toBe(10);
    expect(r.pagination.hasNext).toBe(true);
    expect(r.pagination.hasPrevious).toBe(false);
  });

  test("offset: last page", async () => {
    const r = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 3, skip: 9 });
    expect(r.data).toHaveLength(1);
    expect(r.pagination.hasNext).toBe(false);
    expect(r.pagination.hasPrevious).toBe(true);
  });

  test("offset: cursors are null", async () => {
    const r = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 3, skip: 0 });
    expect(r.pagination.startCursor).toBeNull();
    expect(r.pagination.endCursor).toBeNull();
  });

  test("cursor: forward pages have no overlap", async () => {
    const p1 = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 4 });
    expect(p1.pagination.endCursor).toBeTruthy();
    const p2 = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 4, after: p1.pagination.endCursor! });
    const ids1 = new Set(p1.data.map((r) => (r as any).id));
    for (const r of p2.data) expect(ids1.has((r as any).id)).toBe(false);
  });

  test("cursor: non-null cursors in result", async () => {
    const r = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 3 });
    expect(r.pagination.startCursor).toBeTruthy();
    expect(r.pagination.endCursor).toBeTruthy();
  });

  test("cursor: multi-column keyset covers all rows without duplicates", async () => {
    const p1 = await query.author.paginate({ orderBy: [{ name: "desc" }, { id: "asc" }], take: 5 });
    const p2 = await query.author.paginate({ orderBy: [{ name: "desc" }, { id: "asc" }], take: 5, after: p1.pagination.endCursor! });
    const all = [...p1.data, ...p2.data];
    expect(all).toHaveLength(10);
    expect(new Set(all.map((r) => (r as any).id)).size).toBe(10);
  });

  test("cursor: backward (before) returns same rows as forward page", async () => {
    const fwd  = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 5 });
    const p2   = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 5, after: fwd.pagination.endCursor! });
    const back = await query.author.paginate({ orderBy: [{ id: "asc" }], take: 5, before: p2.pagination.startCursor! });
    expect(fwd.data.map((r) => (r as any).id).sort()).toEqual(back.data.map((r) => (r as any).id).sort());
  });
});

// ── include / relations ────────────────────────────────────────────────────

describe("sola — include & relations", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createSola<DB>>;
  let authorId: number;
  let postId: number;

  beforeAll(async () => {
    ({ db, query } = await makeFixture());
    const [a]  = await db.insertInto("author").values({ name: "Alice", email: "alice@x.com" } as any).returningAll().execute();
    authorId   = (a as any).id as number;
    const [p1] = await db.insertInto("post").values({ title: "Post 1", authorId } as any).returningAll().execute();
    postId     = (p1 as any).id as number;
    await db.insertInto("post").values({ title: "Post 2", authorId } as any).execute();
    const [t1] = await db.insertInto("tag").values({ name: "ts" } as any).returningAll().execute();
    const [t2] = await db.insertInto("tag").values({ name: "js" } as any).returningAll().execute();
    await db.insertInto("post_tag").values([
      { postId, tagId: (t1 as any).id as number },
      { postId, tagId: (t2 as any).id as number },
    ] as any).execute();
  });

  test("hasMany: author includes posts", async () => {
    const authors = await query.author.findMany({ include: { post: true } });
    const alice = authors.find((a) => a.name === "Alice")!;
    expect(Array.isArray((alice as any).post)).toBe(true);
    expect((alice as any).post).toHaveLength(2);
  });

  test("belongsTo: post includes author", async () => {
    const posts = await query.post.findMany({ include: { author: true } });
    expect(posts.length).toBeGreaterThan(0);
    expect((posts[0] as any).author.name).toBe("Alice");
  });

  test("manyToMany: post includes tags via pivot", async () => {
    const posts = await query.post.findMany({ include: { tag: true } });
    const p1 = posts.find((p) => (p as any).id === postId)!;
    const tags = (p1 as any).tag as { name: string }[];
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name).sort()).toEqual(["js", "ts"]);
  });

  test("manyToMany: post with no tags gets empty array", async () => {
    const posts = await query.post.findMany({ include: { tag: true } });
    const p2 = posts.find((p) => (p as any).title === "Post 2")!;
    expect((p2 as any).tag).toHaveLength(0);
  });
});

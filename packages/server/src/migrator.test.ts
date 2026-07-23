import { test, describe, beforeAll, expect } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import {
  Kysely,
  PGliteDialect,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

import { createMigrator, SchemaMigrationProvider } from "./migrator";
import { schema } from "./schema";

function makeDb() {
  const dialect = new PGliteDialect({ pglite: new PGlite() });
  return new Kysely<any>({ dialect });
}

async function tableExists(db: Kysely<any>, name: string): Promise<boolean> {
  const row = await db
    .selectFrom("information_schema.tables" as any)
    .select("table_name" as any)
    .where("table_name" as any, "=", name)
    .where("table_schema" as any, "=", "public")
    .executeTakeFirst();
  return row != null;
}

async function columnExists(db: Kysely<any>, table: string, col: string): Promise<boolean> {
  const row = await db
    .selectFrom("information_schema.columns" as any)
    .select("column_name" as any)
    .where("table_name" as any, "=", table)
    .where("column_name" as any, "=", col)
    .executeTakeFirst();
  return row != null;
}

async function columnType(db: Kysely<any>, table: string, col: string): Promise<string> {
  const row = await db
    .selectFrom("information_schema.columns" as any)
    .select("udt_name" as any)
    .where("table_name" as any, "=", table)
    .where("column_name" as any, "=", col)
    .executeTakeFirstOrThrow();
  return (row as any).udt_name;
}

describe("migrator", () => {
  let db: Kysely<any>;
  beforeAll(() => {
    db = makeDb();
  });

  test("migrateToLatest creates tables from schema", async () => {
    const s = schema("1.0.0")
      .table("author", (t) => ({ id: t.serial().primaryKey(), name: t.text() }))
      .build();

    const { error } = await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await tableExists(db, "author")).toBe(true);
  });

  test("second schema version adds a column", async () => {
    const db2 = makeDb();
    const v1 = schema("1.0.0")
      .table("item", (t) => ({ id: t.serial().primaryKey(), name: t.text() }))
      .build();
    const v2 = schema("2.0.0")
      .table("item", (t) => ({ id: t.serial().primaryKey(), name: t.text(), price: t.integer() }))
      .build();

    const { error, results } = await createMigrator({
      db: db2,
      schemas: [v1, v2],
    }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(results).toHaveLength(2);
    expect(await columnExists(db2, "item", "price")).toBe(true);
  });

  test("second schema version drops a column", async () => {
    const db3 = makeDb();
    const v1 = schema("1.0.0")
      .table("thing", (t) => ({ id: t.serial().primaryKey(), old: t.text() }))
      .build();
    const v2 = schema("2.0.0")
      .table("thing", (t) => ({ id: t.serial().primaryKey() }))
      .build();

    await createMigrator({ db: db3, schemas: [v1, v2] }).migrateToLatest();
    expect(await columnExists(db3, "thing", "old")).toBe(false);
  });

  test("second schema version adds a new table", async () => {
    const db4 = makeDb();
    const v1 = schema("1.0.0")
      .table("a", (t) => ({ id: t.serial().primaryKey() }))
      .build();
    const v2 = schema("2.0.0")
      .table("a", (t) => ({ id: t.serial().primaryKey() }))
      .table("b", (t) => ({ id: t.serial().primaryKey() }))
      .build();

    await createMigrator({ db: db4, schemas: [v1, v2] }).migrateToLatest();
    expect(await tableExists(db4, "b")).toBe(true);
  });

  test("schemas are sorted by version before migration", async () => {
    const db5 = makeDb();
    const v2 = schema("2.0.0")
      .table("t", (t) => ({ id: t.serial().primaryKey(), added: t.text() }))
      .build();
    const v1 = schema("1.0.0")
      .table("t", (t) => ({ id: t.serial().primaryKey() }))
      .build();

    const { error } = await createMigrator({ db: db5, schemas: [v2, v1] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await columnExists(db5, "t", "added")).toBe(true);
  });

  test("versions that sort numerically but not lexicographically are rejected", async () => {
    const db6 = makeDb();
    const v1 = schema("1.2.0")
      .table("t2", (t) => ({ id: t.serial().primaryKey() }))
      .build();
    const v2 = schema("1.10.0")
      .table("t2", (t) => ({ id: t.serial().primaryKey(), added: t.text() }))
      .build();

    // Kysely applies migrations in lexicographic order of the version-string keys, which
    // disagrees with numeric order here ("1.10.0" < "1.2.0" as a string) — must fail loudly
    // instead of silently migrating out of order.
    const { error } = await createMigrator({ db: db6, schemas: [v2, v1] }).migrateToLatest();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/zero-pad/i);
  });

  test("zero-padded versions that sort numerically and lexicographically the same way succeed", async () => {
    const db7 = makeDb();
    const v1 = schema("1.02.0")
      .table("t3", (t) => ({ id: t.serial().primaryKey() }))
      .build();
    const v2 = schema("1.10.0")
      .table("t3", (t) => ({ id: t.serial().primaryKey(), added: t.text() }))
      .build();

    const { error } = await createMigrator({ db: db7, schemas: [v2, v1] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await columnExists(db7, "t3", "added")).toBe(true);
  });

  test("SchemaMigrationProvider returns one migration per schema", async () => {
    const v1 = schema("1.0.0")
      .table("x", (t) => ({ id: t.text().primaryKey() }))
      .build();
    const v2 = schema("2.0.0")
      .table("x", (t) => ({ id: t.text().primaryKey(), y: t.text() }))
      .build();
    const migrations = await new SchemaMigrationProvider([v1, v2]).getMigrations();
    expect("1.0.0" in migrations).toBe(true);
    expect("2.0.0" in migrations).toBe(true);
    expect(Object.keys(migrations)).toHaveLength(2);
  });
});

describe("dialect kinds", () => {
  test("defaults to postgres DDL types", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("post", (t) => ({
        id: t.serial().primaryKey(),
        body: t.jsonb(),
        userId: t.uuid(),
        postedAt: t.timestamp(),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();

    expect(await columnType(db, "post", "id")).toBe("int4");
    expect(await columnType(db, "post", "body")).toBe("jsonb");
    expect(await columnType(db, "post", "userId")).toBe("uuid");
    expect(await columnType(db, "post", "postedAt")).toBe("timestamptz");
  });

  test("boolean defaults render as 1/0 on sqlite", async () => {
    const s = schema("1.0.0")
      .table("flagged", (t) => ({
        id: t.serial().primaryKey(),
        on: t.boolean().default(true),
        off: t.boolean().default(false),
        label: t.text().default("hi"),
      }))
      .build();

    const captured: string[] = [];
    const db = new Kysely<any>({
      dialect: {
        createDriver: () => ({
          async init() {},
          async acquireConnection() {
            return {
              async executeQuery(compiled: any) {
                captured.push(compiled.sql);
                return { rows: [] };
              },
              async *streamQuery() {},
            };
          },
          async beginTransaction() {},
          async commitTransaction() {},
          async rollbackTransaction() {},
          async releaseConnection() {},
          async destroy() {},
        }),
        createAdapter: () => new SqliteAdapter(),
        createIntrospector: (d: Kysely<any>) => new SqliteIntrospector(d),
        createQueryCompiler: () => new SqliteQueryCompiler(),
      },
    });
    await createMigrator({ db, schemas: [s], kind: "sqlite" }).migrateToLatest();
    const ddl = captured.find((q) => q.includes("create table") && q.includes("flagged"))!;
    // SQLite has no boolean literal — `true` would be a syntax error there.
    expect(ddl).toContain("default 1");
    expect(ddl).toContain("default 0");
    expect(ddl).toContain("default 'hi'");
  });

  test("kind: 'sqlite' generates SQLite-compatible DDL types", async () => {
    const s = schema("1.0.0")
      .table("post", (t) => ({
        id: t.serial().primaryKey(),
        body: t.jsonb(),
        userId: t.uuid(),
        postedAt: t.timestamp(),
        title: t.varchar(),
        active: t.boolean(),
      }))
      .build();

    const captured: string[] = [];
    const db = new Kysely<any>({
      dialect: {
        createDriver: () => ({
          async init() {},
          async acquireConnection() {
            return {
              async executeQuery(compiled: any) {
                captured.push(compiled.sql);
                return { rows: [] };
              },
              async *streamQuery() {},
            };
          },
          async beginTransaction() {},
          async commitTransaction() {},
          async rollbackTransaction() {},
          async releaseConnection() {},
          async destroy() {},
        }),
        createQueryCompiler: () => new SqliteQueryCompiler(),
        createAdapter: () => new SqliteAdapter(),
        createIntrospector: (introspectedDb: Kysely<any>) => new SqliteIntrospector(introspectedDb),
      },
    });

    const migrations = await new SchemaMigrationProvider([s], "sqlite").getMigrations();
    await migrations["1.0.0"]!.up(db);

    const createSql = captured.find((sql) => sql.includes("create table"))!;
    expect(createSql).not.toContain("serial");
    expect(createSql).not.toContain("jsonb");
    expect(createSql).not.toContain("timestamptz");
    expect(createSql).not.toContain("uuid");
    expect(createSql).toContain("integer");
    expect(createSql).toContain("text");
  });
});

describe("schema().files()", () => {
  test("creates the file table and links it to the owner", async () => {
    const db = makeDb();
    const s = schema("1.0.0").auth().files().build();

    const { error } = await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await tableExists(db, "file")).toBe(true);
    for (const col of ["id", "key", "name", "type", "size", "userId", "createdAt"]) {
      expect(await columnExists(db, "file", col)).toBe(true);
    }
    expect(await columnType(db, "file", "size")).toBe("int4");
    expect(s.relations).toContainEqual(
      expect.objectContaining({ kind: "belongsTo", fromTable: "file", toTable: "user" }),
    );
  });

  test("owner: false drops the userId column, so no .auth() is needed", async () => {
    const db = makeDb();
    const s = schema("1.0.0").files({ owner: false }).build();

    const { error } = await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await columnExists(db, "file", "userId")).toBe(false);
    expect(s.relations).toHaveLength(0);
  });

  test("attachTo creates a pivot table and manyToMany relations both ways", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .auth()
      .table("post", (t) => ({ id: t.text().primaryKey(), title: t.text() }))
      .files({ attachTo: ["post"] })
      .build();

    const { error } = await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await tableExists(db, "post_file")).toBe(true);
    for (const col of ["fileId", "entityId", "role", "position"]) {
      expect(await columnExists(db, "post_file", col)).toBe(true);
    }
    expect(s.relations).toContainEqual(
      expect.objectContaining({
        kind: "manyToMany",
        fromTable: "post",
        toTable: "file",
        pivotTable: "post_file",
        pivotFromCol: "entityId",
        pivotToCol: "fileId",
      }),
    );
    expect(s.relations).toContainEqual(
      expect.objectContaining({ kind: "manyToMany", fromTable: "file", toTable: "post" }),
    );
  });

  test("the pivot's foreign keys are enforced", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .auth()
      .table("post", (t) => ({ id: t.text().primaryKey(), title: t.text() }))
      .files({ attachTo: ["post"] })
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();

    await expect(
      db
        .insertInto("post_file")
        .values({ id: "a", fileId: "missing", entityId: "missing" })
        .execute(),
    ).rejects.toThrow();
  });

  test("the pivot's entityId matches a serial primary key (integer, not text)", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .auth()
      .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
      .files({ attachTo: ["post"] })
      .build();

    const { error } = await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect((s.tables["post_file"] as any).entityId._type).toBe("integer");

    // Round-trip through the FK to prove the types line up.
    await db.insertInto("post").values({ title: "hello" }).execute();
    await db
      .insertInto("file")
      .values({ id: "f1", key: "k1", name: "n", type: "text/plain", size: 1 })
      .execute();
    await db.insertInto("post_file").values({ id: "a", fileId: "f1", entityId: 1 }).execute();
  });
});

// ── In-place column changes ────────────────────────────────────────────────

describe("migrator — column changes", () => {
  const v1 = schema("1.0.0")
    .table("thing", (t) => ({ id: t.serial().primaryKey(), name: t.text() }))
    .build();

  /** Every kind of in-place edit must be refused rather than silently ignored. */
  const cases: { label: string; v2: any }[] = [
    {
      label: "nullability",
      v2: schema("2.0.0")
        .table("thing", (t) => ({ id: t.serial().primaryKey(), name: t.text().nullable() }))
        .build(),
    },
    {
      label: "type",
      v2: schema("2.0.0")
        .table("thing", (t) => ({ id: t.serial().primaryKey(), name: t.integer() }))
        .build(),
    },
    {
      label: "default",
      v2: schema("2.0.0")
        .table("thing", (t) => ({
          id: t.serial().primaryKey(),
          name: t.text().default("anon"),
        }))
        .build(),
    },
    {
      label: "uniqueness",
      v2: schema("2.0.0")
        .table("thing", (t) => ({ id: t.serial().primaryKey(), name: t.text().unique() }))
        .build(),
    },
    {
      label: "foreign key",
      v2: schema("2.0.0")
        .table("thing", (t) => ({
          id: t.serial().primaryKey(),
          name: t.text().references("other", "id"),
        }))
        .build(),
    },
  ];

  for (const { label, v2 } of cases) {
    test(`refuses to migrate a changed ${label} instead of silently ignoring it`, async () => {
      const db = makeDb();
      const { error } = await createMigrator({ db, schemas: [v1, v2] }).migrateToLatest();
      expect(error).toBeDefined();
      expect(String(error)).toMatch(/changes existing columns/);
    });
  }

  test("the error names the table and the column that changed", async () => {
    const db = makeDb();
    const v2 = schema("2.0.0")
      .table("thing", (t) => ({ id: t.serial().primaryKey(), name: t.text().nullable() }))
      .build();
    const { error } = await createMigrator({ db, schemas: [v1, v2] }).migrateToLatest();
    expect(String(error)).toMatch(/thing/);
    expect(String(error)).toMatch(/name: became nullable/);
  });

  test("an unchanged column alongside an added one still migrates", async () => {
    const db = makeDb();
    const v2 = schema("2.0.0")
      .table("thing", (t) => ({
        id: t.serial().primaryKey(),
        name: t.text(),
        extra: t.text().nullable(),
      }))
      .build();
    const { error } = await createMigrator({ db, schemas: [v1, v2] }).migrateToLatest();
    expect(error).toBeUndefined();
    expect(await columnExists(db, "thing", "extra")).toBe(true);
  });
});

// ── Referential actions, indexes, defaults, column types ───────────────────

describe("migrator — referential actions", () => {
  test("onDelete cascade removes dependent rows instead of blocking the delete", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("owner", (t) => ({ id: t.text().primaryKey() }))
      .table("child", (t) => ({
        id: t.text().primaryKey(),
        ownerId: t.text().references("owner", "id", { onDelete: "cascade" }),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    await db.insertInto("owner").values({ id: "o1" }).execute();
    await db.insertInto("child").values({ id: "c1", ownerId: "o1" }).execute();

    await db.deleteFrom("owner").where("id", "=", "o1").execute();
    const rows = await db.selectFrom("child").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  test("without an action the delete is rejected by the FK", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("owner", (t) => ({ id: t.text().primaryKey() }))
      .table("child", (t) => ({
        id: t.text().primaryKey(),
        ownerId: t.text().references("owner", "id"),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    await db.insertInto("owner").values({ id: "o1" }).execute();
    await db.insertInto("child").values({ id: "c1", ownerId: "o1" }).execute();

    await expect(db.deleteFrom("owner").where("id", "=", "o1").execute()).rejects.toThrow();
  });

  test("onDelete set null clears the reference", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("owner", (t) => ({ id: t.text().primaryKey() }))
      .table("child", (t) => ({
        id: t.text().primaryKey(),
        ownerId: t.text().nullable().references("owner", "id", { onDelete: "set null" }),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    await db.insertInto("owner").values({ id: "o1" }).execute();
    await db.insertInto("child").values({ id: "c1", ownerId: "o1" }).execute();

    await db.deleteFrom("owner").where("id", "=", "o1").execute();
    const row = await db.selectFrom("child").selectAll().executeTakeFirstOrThrow();
    expect((row as any).ownerId).toBeNull();
  });

  test("deleting a user cascades to their sessions (built-in auth tables)", async () => {
    const db = makeDb();
    const s = schema("1.0.0").auth().build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    const now = new Date();
    await db
      .insertInto("user")
      .values({ id: "u1", name: "n", email: "e@x.com", emailVerified: false })
      .execute();
    await db
      .insertInto("session")
      .values({ id: "s1", token: "t1", userId: "u1", expiresAt: now })
      .execute();

    await db.deleteFrom("user").where("id", "=", "u1").execute();
    expect(await db.selectFrom("session").selectAll().execute()).toHaveLength(0);
  });
});

describe("migrator — indexes", () => {
  async function indexExists(db: Kysely<any>, name: string): Promise<boolean> {
    const row = await db
      .selectFrom("pg_indexes" as any)
      .select("indexname" as any)
      .where("indexname" as any, "=", name)
      .executeTakeFirst();
    return row != null;
  }

  test("index() creates one, and a column added later gets one too", async () => {
    const db = makeDb();
    const v1 = schema("1.0.0")
      .table("thing", (t) => ({ id: t.serial().primaryKey(), slug: t.text().index() }))
      .build();
    const v2 = schema("2.0.0")
      .table("thing", (t) => ({
        id: t.serial().primaryKey(),
        slug: t.text().index(),
        later: t.text().nullable().index(),
      }))
      .build();
    await createMigrator({ db, schemas: [v1, v2] }).migrateToLatest();
    expect(await indexExists(db, "thing_slug_idx")).toBe(true);
    expect(await indexExists(db, "thing_later_idx")).toBe(true);
  });

  test("unique columns get no second index", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("thing", (t) => ({ id: t.serial().primaryKey(), slug: t.text().unique().index() }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(await indexExists(db, "thing_slug_idx")).toBe(false);
  });
});

describe("migrator — defaults and column types", () => {
  test("literal defaults are quoted by type", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("thing", (t) => ({
        id: t.serial().primaryKey(),
        name: t.text().default("anon"),
        flag: t.boolean().default(true),
        count: t.integer().default(7),
        // a value with an embedded quote must not break the DDL
        tricky: t.text().default("O'Brien"),
        at: t.timestamp().defaultSql("CURRENT_TIMESTAMP"),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    await db.insertInto("thing").defaultValues().execute();
    const row: any = await db.selectFrom("thing").selectAll().executeTakeFirstOrThrow();
    expect(row.name).toBe("anon");
    expect(row.flag).toBe(true);
    expect(row.count).toBe(7);
    expect(row.tricky).toBe("O'Brien");
    expect(row.at).toBeInstanceOf(Date);
  });

  test("the new column types round-trip", async () => {
    const db = makeDb();
    const s = schema("1.0.0")
      .table("wide", (t) => ({
        id: t.serial().primaryKey(),
        big: t.bigint(),
        money: t.decimal(),
        ratio: t.real(),
        day: t.date(),
        blob: t.bytes(),
      }))
      .build();
    await createMigrator({ db, schemas: [s] }).migrateToLatest();
    expect(await columnType(db, "wide", "big")).toBe("int8");
    expect(await columnType(db, "wide", "money")).toBe("numeric");
    expect(await columnType(db, "wide", "day")).toBe("date");
    expect(await columnType(db, "wide", "blob")).toBe("bytea");

    await db
      .insertInto("wide")
      .values({
        big: "9007199254740993", // beyond Number.MAX_SAFE_INTEGER
        money: "10.05",
        ratio: 0.5,
        day: new Date("2026-01-02"),
        blob: Buffer.from([1, 2, 3]),
      })
      .execute();
    const row: any = await db.selectFrom("wide").selectAll().executeTakeFirstOrThrow();
    expect(String(row.big)).toBe("9007199254740993"); // no float rounding
    expect(String(row.money)).toBe("10.05");
  });
});

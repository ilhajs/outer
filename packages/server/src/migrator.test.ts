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
});

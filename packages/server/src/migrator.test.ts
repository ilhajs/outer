import { test, describe, beforeAll, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { schema } from "./schema";
import { createMigrator, SchemaMigrationProvider } from "./migrator";

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

    const { error, results } = await createMigrator({ db: db2, schemas: [v1, v2] }).migrateToLatest();
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

  test("SchemaMigrationProvider returns one migration per schema", async () => {
    const v1 = schema("1.0.0").table("x", (t) => ({ id: t.text().primaryKey() })).build();
    const v2 = schema("2.0.0").table("x", (t) => ({ id: t.text().primaryKey(), y: t.text() })).build();
    const migrations = await new SchemaMigrationProvider([v1, v2]).getMigrations();
    expect("1.0.0" in migrations).toBe(true);
    expect("2.0.0" in migrations).toBe(true);
    expect(Object.keys(migrations)).toHaveLength(2);
  });
});

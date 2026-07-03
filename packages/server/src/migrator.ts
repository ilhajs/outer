import { Kysely, sql } from "kysely";
import { Migrator, MigrationProvider, Migration } from "kysely/migration";

import { SchemaResult, ColumnDef, TablesDef } from "./schema";

/**
 * The dialect families Outer knows how to generate DDL for. PGlite (the
 * default, embedded DB) speaks real Postgres wire protocol, so it's `"postgres"`.
 * Bring your own Kysely `Dialect` via `db: { dialect, kind }` to target something
 * else — e.g. `"sqlite"` for Cloudflare D1 / Durable Objects.
 */
export type DialectKind = "postgres" | "sqlite";

/** Column-kind → raw SQL type, per dialect family. Abstract column kinds (from `schema.ts`) don't map 1:1 to SQL types across dialects — e.g. SQLite has no `serial`/`jsonb`/`uuid` types. */
const SQL_TYPE_BY_KIND: Record<DialectKind, Record<string, any>> = {
  postgres: {
    serial: "serial",
    text: "text",
    varchar: "varchar",
    integer: "integer",
    boolean: "boolean",
    timestamp: "timestamptz",
    jsonb: "jsonb",
    uuid: "uuid",
  },
  sqlite: {
    // `integer primary key` auto-increments as SQLite's rowid alias, so
    // "serial" simply maps to a plain integer column.
    serial: "integer",
    text: "text",
    varchar: "text",
    integer: "integer",
    boolean: "integer",
    timestamp: "text",
    jsonb: "text",
    uuid: "text",
  },
};

function applyCol({ col, builder }: { col: ColumnDef; builder: any }): any {
  if (col._primaryKey) builder = builder.primaryKey();
  if (!col._nullable) builder = builder.notNull();
  if (col._unique) builder = builder.unique();
  if (col._default !== null) builder = builder.defaultTo(sql.raw(col._default));
  if (col._references)
    builder = builder.references(`${col._references.table}.${col._references.column}`);
  return builder;
}

async function createTable({
  db,
  tableName,
  cols,
  kind,
}: {
  db: Kysely<any>;
  tableName: string;
  cols: Record<string, ColumnDef>;
  kind: DialectKind;
}): Promise<void> {
  const sqlType = SQL_TYPE_BY_KIND[kind];
  let builder = db.schema.createTable(tableName);
  for (const [colName, col] of Object.entries(cols)) {
    builder = builder.addColumn(colName, sqlType[col._type]!, (b: any) =>
      applyCol({ col, builder: b }),
    );
  }
  await builder.execute();
}

async function dropTable({ db, tableName }: { db: Kysely<any>; tableName: string }): Promise<void> {
  await db.schema.dropTable(tableName).ifExists().cascade().execute();
}

function buildMigration({
  current,
  previous,
  kind,
}: {
  current: SchemaResult<any>;
  previous: SchemaResult<any> | null;
  kind: DialectKind;
}): Migration {
  const currentTables = current.tables as TablesDef;
  const previousTables = (previous?.tables ?? {}) as TablesDef;
  const sqlType = SQL_TYPE_BY_KIND[kind];

  const addedTables = Object.keys(currentTables).filter((t) => !(t in previousTables));
  const droppedTables = Object.keys(previousTables).filter((t) => !(t in currentTables));

  const alteredTables = Object.keys(currentTables)
    .filter((t) => t in previousTables)
    .map((tableName) => {
      const prev = previousTables[tableName]!;
      const curr = currentTables[tableName]!;
      const addedCols = Object.entries(curr).filter(([c]) => !(c in prev)) as [string, ColumnDef][];
      const droppedCols = Object.keys(prev).filter((c) => !(c in curr));
      return { tableName, addedCols, droppedCols };
    })
    .filter(({ addedCols, droppedCols }) => addedCols.length > 0 || droppedCols.length > 0);

  return {
    async up(db: Kysely<any>) {
      for (const tableName of addedTables) {
        await createTable({ db, tableName, cols: currentTables[tableName]!, kind });
      }
      for (const { tableName, addedCols, droppedCols } of alteredTables) {
        for (const [colName, col] of addedCols) {
          await db.schema
            .alterTable(tableName)
            .addColumn(colName, sqlType[col._type]!, (b: any) => applyCol({ col, builder: b }))
            .execute();
        }
        for (const colName of droppedCols) {
          await db.schema.alterTable(tableName).dropColumn(colName).execute();
        }
      }
    },
    async down(db: Kysely<any>) {
      for (const { tableName, addedCols, droppedCols } of [...alteredTables].reverse()) {
        for (const [colName] of addedCols) {
          await db.schema.alterTable(tableName).dropColumn(colName).execute();
        }
        for (const colName of droppedCols) {
          const col = previousTables[tableName]![colName]!;
          await db.schema
            .alterTable(tableName)
            .addColumn(colName, sqlType[col._type]!, (b: any) => applyCol({ col, builder: b }))
            .execute();
        }
      }
      for (const tableName of [...addedTables].reverse()) {
        await dropTable({ db, tableName });
      }
      for (const tableName of droppedTables) {
        await createTable({ db, tableName, cols: previousTables[tableName]!, kind });
      }
    },
  };
}

export class SchemaMigrationProvider implements MigrationProvider {
  constructor(
    private readonly schemas: SchemaResult<any>[],
    private readonly kind: DialectKind = "postgres",
  ) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const sorted = [...this.schemas].sort((a, b) => a.version.localeCompare(b.version));
    const migrations: Record<string, Migration> = {};
    for (let i = 0; i < sorted.length; i++) {
      migrations[sorted[i]!.version] = buildMigration({
        current: sorted[i]!,
        previous: sorted[i - 1] ?? null,
        kind: this.kind,
      });
    }
    return migrations;
  }
}

export function createMigrator({
  db,
  schemas,
  kind = "postgres",
}: {
  db: Kysely<any>;
  schemas: SchemaResult<any>[];
  kind?: DialectKind;
}): Migrator {
  return new Migrator({
    db,
    provider: new SchemaMigrationProvider(schemas, kind),
  });
}

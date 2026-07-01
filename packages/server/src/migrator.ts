import { Kysely, sql } from "kysely";
import { Migrator, MigrationProvider, Migration } from "kysely/migration";
import { SchemaResult, ColumnDef, TablesDef } from "./schema";

const SQL_TYPE: Record<string, any> = {
  serial: "serial",
  text: "text",
  varchar: "varchar",
  integer: "integer",
  boolean: "boolean",
  timestamp: "timestamptz",
  jsonb: "jsonb",
  uuid: "uuid",
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
}: {
  db: Kysely<any>;
  tableName: string;
  cols: Record<string, ColumnDef>;
}): Promise<void> {
  let builder = db.schema.createTable(tableName);
  for (const [colName, col] of Object.entries(cols)) {
    builder = builder.addColumn(colName, SQL_TYPE[col._type]!, (b: any) =>
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
}: {
  current: SchemaResult<any>;
  previous: SchemaResult<any> | null;
}): Migration {
  const currentTables = current.tables as TablesDef;
  const previousTables = (previous?.tables ?? {}) as TablesDef;

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
        await createTable({ db, tableName, cols: currentTables[tableName]! });
      }
      for (const { tableName, addedCols, droppedCols } of alteredTables) {
        for (const [colName, col] of addedCols) {
          await db.schema
            .alterTable(tableName)
            .addColumn(colName, SQL_TYPE[col._type]!, (b: any) => applyCol({ col, builder: b }))
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
            .addColumn(colName, SQL_TYPE[col._type]!, (b: any) => applyCol({ col, builder: b }))
            .execute();
        }
      }
      for (const tableName of [...addedTables].reverse()) {
        await dropTable({ db, tableName });
      }
      for (const tableName of droppedTables) {
        await createTable({ db, tableName, cols: previousTables[tableName]! });
      }
    },
  };
}

export class SchemaMigrationProvider implements MigrationProvider {
  constructor(private readonly schemas: SchemaResult<any>[]) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const sorted = [...this.schemas].sort((a, b) => a.version.localeCompare(b.version));
    const migrations: Record<string, Migration> = {};
    for (let i = 0; i < sorted.length; i++) {
      migrations[sorted[i]!.version] = buildMigration({
        current: sorted[i]!,
        previous: sorted[i - 1] ?? null,
      });
    }
    return migrations;
  }
}

export function createMigrator({
  db,
  schemas,
}: {
  db: Kysely<any>;
  schemas: SchemaResult<any>[];
}): Migrator {
  return new Migrator({
    db,
    provider: new SchemaMigrationProvider(schemas),
  });
}

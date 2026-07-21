import { Kysely, sql } from "kysely";
import { Migrator, MigrationProvider, Migration } from "kysely/migration";

import { SchemaResult, AnyColumn, ColumnDef, TablesDef, renderDefault } from "./schema";

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
    bigint: "bigint",
    decimal: "numeric",
    real: "double precision",
    boolean: "boolean",
    timestamp: "timestamptz",
    date: "date",
    jsonb: "jsonb",
    uuid: "uuid",
    bytes: "bytea",
  },
  sqlite: {
    // `integer primary key` auto-increments as SQLite's rowid alias, so
    // "serial" simply maps to a plain integer column.
    serial: "integer",
    text: "text",
    varchar: "text",
    integer: "integer",
    bigint: "integer",
    // TEXT, not NUMERIC: SQLite's NUMERIC affinity would coerce exact values
    // into floats and lose precision — the whole point of `decimal`.
    decimal: "text",
    real: "real",
    boolean: "integer",
    timestamp: "text",
    date: "text",
    jsonb: "text",
    uuid: "text",
    bytes: "blob",
  },
};

function applyCol({
  col,
  builder,
  kind,
}: {
  col: ColumnDef;
  builder: any;
  kind: DialectKind;
}): any {
  if (col._primaryKey) builder = builder.primaryKey();
  if (!col._nullable) builder = builder.notNull();
  if (col._unique) builder = builder.unique();
  if (col._default !== null) {
    builder = builder.defaultTo(sql.raw(renderDefault(col._default, col._type, kind)));
  }
  if (col._references) {
    builder = builder.references(`${col._references.table}.${col._references.column}`);
    if (col._references.onDelete) builder = builder.onDelete(col._references.onDelete);
    if (col._references.onUpdate) builder = builder.onUpdate(col._references.onUpdate);
  }
  return builder;
}

/** The ways a column can differ from its previous version, in human-readable form. */
function describeColumnChanges(prev: ColumnDef, curr: ColumnDef): string[] {
  const changes: string[] = [];
  if (prev._type !== curr._type) changes.push(`type ${prev._type} -> ${curr._type}`);
  if (prev._nullable !== curr._nullable) {
    changes.push(curr._nullable ? "became nullable" : "became not-null");
  }
  if (prev._primaryKey !== curr._primaryKey) {
    changes.push(curr._primaryKey ? "became a primary key" : "no longer a primary key");
  }
  if (prev._unique !== curr._unique) {
    changes.push(curr._unique ? "became unique" : "no longer unique");
  }
  if (JSON.stringify(prev._default) !== JSON.stringify(curr._default)) {
    changes.push(
      `default ${JSON.stringify(prev._default) ?? "none"} -> ${JSON.stringify(curr._default) ?? "none"}`,
    );
  }
  if (JSON.stringify(prev._references) !== JSON.stringify(curr._references)) {
    changes.push("foreign key changed");
  }
  if (prev._index !== curr._index) changes.push(curr._index ? "index added" : "index removed");
  return changes;
}

/** Index name for a single-column index — stable, so the down migration can drop it. */
function indexName(table: string, column: string): string {
  return `${table}_${column}_idx`;
}

async function createIndexes({
  db,
  tableName,
  cols,
}: {
  db: Kysely<any>;
  tableName: string;
  cols: Record<string, AnyColumn>;
}): Promise<void> {
  for (const [colName, col] of Object.entries(cols)) {
    // `unique` already creates an index; a second one would be dead weight.
    if (!col._index || col._unique) continue;
    await db.schema
      .createIndex(indexName(tableName, colName))
      .on(tableName)
      .column(colName)
      .execute();
  }
}

async function createTable({
  db,
  tableName,
  cols,
  kind,
}: {
  db: Kysely<any>;
  tableName: string;
  cols: Record<string, AnyColumn>;
  kind: DialectKind;
}): Promise<void> {
  const sqlType = SQL_TYPE_BY_KIND[kind];
  let builder = db.schema.createTable(tableName);
  for (const [colName, col] of Object.entries(cols)) {
    builder = builder.addColumn(colName, sqlType[col._type]!, (b: any) =>
      applyCol({ col, builder: b, kind }),
    );
  }
  await builder.execute();
  await createIndexes({ db, tableName, cols });
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
      const changedCols = Object.keys(curr)
        .filter((c) => c in prev)
        .flatMap((c) =>
          describeColumnChanges(prev[c]!, curr[c]!).map((change) => `${c}: ${change}`),
        );
      return { tableName, addedCols, droppedCols, changedCols };
    })
    .filter(
      ({ addedCols, droppedCols, changedCols }) =>
        addedCols.length > 0 || droppedCols.length > 0 || changedCols.length > 0,
    );

  // A column edited in place produces no add/drop, so it used to migrate to
  // nothing at all — the schema and the database would silently disagree.
  // Refuse to build the migration rather than let them drift apart.
  const unsupported = alteredTables
    .filter(({ changedCols }) => changedCols.length > 0)
    .map(({ tableName, changedCols }) => `  ${tableName}\n    ${changedCols.join("\n    ")}`);
  if (unsupported.length > 0) {
    throw new Error(
      `Schema version "${current.version}" changes existing columns, which Outer cannot migrate automatically:\n` +
        `${unsupported.join("\n")}\n\n` +
        `Adding and dropping columns is supported; altering one in place is not. ` +
        `Either revert the change, or write the ALTER yourself and keep the schema in sync ` +
        `(renaming a column is a drop plus an add, which loses its data).`,
    );
  }

  return {
    async up(db: Kysely<any>) {
      for (const tableName of addedTables) {
        await createTable({ db, tableName, cols: currentTables[tableName]!, kind });
      }
      for (const { tableName, addedCols, droppedCols } of alteredTables) {
        for (const [colName, col] of addedCols) {
          await db.schema
            .alterTable(tableName)
            .addColumn(colName, sqlType[col._type]!, (b: any) =>
              applyCol({ col, builder: b, kind }),
            )
            .execute();
          if (col._index && !col._unique) {
            await db.schema
              .createIndex(indexName(tableName, colName))
              .on(tableName)
              .column(colName)
              .execute();
          }
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
            .addColumn(colName, sqlType[col._type]!, (b: any) =>
              applyCol({ col, builder: b, kind }),
            )
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

/** Compares dot-separated numeric versions (e.g. "1.10.0" > "1.2.0"), unlike string/locale comparison. */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class SchemaMigrationProvider implements MigrationProvider {
  constructor(
    private readonly schemas: SchemaResult<any>[],
    private readonly kind: DialectKind = "postgres",
  ) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const sorted = [...this.schemas].sort((a, b) => compareVersions(a.version, b.version));

    // Kysely's own Migrator re-sorts migration names with a plain lexicographic
    // `Array.prototype.sort()` before applying them — it ignores the order this
    // object is built in. If that lexicographic order disagrees with numeric
    // version order (e.g. "1.10.0" sorts before "1.2.0" as plain strings), the
    // migrations would silently run in the wrong order. Fail loudly instead.
    const numericOrder = sorted.map((s) => s.version);
    const lexicalOrder = [...numericOrder].sort();
    if (numericOrder.some((v, i) => v !== lexicalOrder[i])) {
      throw new Error(
        `Schema versions [${numericOrder.join(", ")}] sort correctly by number but not lexicographically, ` +
          `and migrations run in lexicographic order internally — this would apply them out of order. ` +
          `Zero-pad each segment (e.g. "1.02.00" instead of "1.2.0") so numeric and lexicographic order match.`,
      );
    }

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
    // Kysely's Migrator re-sorts migration names itself (default: localeCompare) before
    // running them, regardless of the order SchemaMigrationProvider.getMigrations() returns —
    // so version ordering must also be enforced here, not just in the provider.
    nameComparator: compareVersions,
  });
}

// ── Column ─────────────────────────────────────────────────────────────────

type SQLTypeMap = {
  serial: number;
  text: string;
  varchar: string;
  integer: number;
  boolean: boolean;
  timestamp: Date;
  jsonb: unknown;
  uuid: string;
};

type SQLType = keyof SQLTypeMap;

export type ColumnDef<T extends SQLType = SQLType, Null extends boolean = boolean> = {
  _type: T;
  _nullable: Null;
  _primaryKey: boolean;
  _unique: boolean;
  _default: string | null;
  _references: { table: string; column: string } | null;
  nullable(): ColumnDef<T, true>;
  primaryKey(): ColumnDef<T, Null>;
  unique(): ColumnDef<T, Null>;
  default(expr: string): ColumnDef<T, Null>;
  references(table: string, column: string): ColumnDef<T, Null>;
};

function makeCol<T extends SQLType>(type: T): ColumnDef<T, false> {
  const def: ColumnDef<T, false> = {
    _type: type,
    _nullable: false as const,
    _primaryKey: false,
    _unique: false,
    _default: null,
    _references: null,
    nullable() {
      return { ...this, _nullable: true as const } as unknown as ColumnDef<T, true>;
    },
    primaryKey() {
      return { ...this, _primaryKey: true };
    },
    unique() {
      return { ...this, _unique: true };
    },
    default(expr: string) {
      return { ...this, _default: expr };
    },
    references(table: string, column: string) {
      return { ...this, _references: { table, column } };
    },
  };
  return def;
}

export type TableBuilder = {
  serial(): ColumnDef<"serial", false>;
  text(): ColumnDef<"text", false>;
  varchar(): ColumnDef<"varchar", false>;
  integer(): ColumnDef<"integer", false>;
  boolean(): ColumnDef<"boolean", false>;
  timestamp(): ColumnDef<"timestamp", false>;
  jsonb(): ColumnDef<"jsonb", false>;
  uuid(): ColumnDef<"uuid", false>;
};

const t: TableBuilder = {
  serial: () => makeCol("serial"),
  text: () => makeCol("text"),
  varchar: () => makeCol("varchar"),
  integer: () => makeCol("integer"),
  boolean: () => makeCol("boolean"),
  timestamp: () => makeCol("timestamp"),
  jsonb: () => makeCol("jsonb"),
  uuid: () => makeCol("uuid"),
};

// ── Relations ──────────────────────────────────────────────────────────────

type RelationKind = "hasMany" | "hasOne" | "belongsTo" | "manyToMany";

export type RelationDef = {
  kind: RelationKind;
  fromTable: string;
  toTable: string;
  fromCol: string;
  toCol: string;
  pivotTable?: string;
  /** Pivot column that references the source table (only for manyToMany). */
  pivotFromCol?: string;
  /** Pivot column that references the target table (only for manyToMany). */
  pivotToCol?: string;
};

type RelationChain = {
  hasMany(to: string, cols: { from: string; to: string }): RelationDef;
  hasOne(to: string, cols: { from: string; to: string }): RelationDef;
  belongsTo(to: string, cols: { from: string; to: string }): RelationDef;
  manyToMany(
    to: string,
    via: string,
    cols: { from: string; to: string; pivotFrom: string; pivotTo: string },
  ): RelationDef;
};

function makeRelChain(fromTable: string): RelationChain {
  return {
    hasMany: (to, cols) => ({
      kind: "hasMany",
      fromTable,
      toTable: to,
      fromCol: cols.from,
      toCol: cols.to,
    }),
    hasOne: (to, cols) => ({
      kind: "hasOne",
      fromTable,
      toTable: to,
      fromCol: cols.from,
      toCol: cols.to,
    }),
    belongsTo: (to, cols) => ({
      kind: "belongsTo",
      fromTable,
      toTable: to,
      fromCol: cols.from,
      toCol: cols.to,
    }),
    manyToMany: (to, via, cols) => ({
      kind: "manyToMany",
      fromTable,
      toTable: to,
      fromCol: cols.from,
      toCol: cols.to,
      pivotTable: via,
      pivotFromCol: cols.pivotFrom,
      pivotToCol: cols.pivotTo,
    }),
  };
}

// ── Type inference ─────────────────────────────────────────────────────────

export type TablesDef = Record<string, Record<string, ColumnDef>>;

// serial columns are DB-generated and optional in both insert and select contexts
type InferRow<T extends Record<string, ColumnDef>> = {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? never
    : T[K]["_nullable"] extends false
      ? K
      : never]: SQLTypeMap[T[K]["_type"]];
} & {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? K
    : T[K]["_nullable"] extends true
      ? K
      : never]?: SQLTypeMap[T[K]["_type"]] | null;
};

export type InferDB<T extends TablesDef> = {
  [Table in keyof T]: InferRow<T[Table]>;
};

// ── Builder ────────────────────────────────────────────────────────────────

export type SchemaResult<T extends TablesDef> = {
  version: string;
  tables: T;
  relations: RelationDef[];
  _db: InferDB<T>;
};

type SchemaBuilder<T extends TablesDef> = {
  table<Name extends string, Cols extends Record<string, ColumnDef>>(
    name: Name,
    define: (t: TableBuilder) => Cols,
  ): SchemaBuilder<T & Record<Name, Cols>>;

  relation(
    fromTable: keyof T & string,
    define: (rel: RelationChain) => RelationDef,
  ): SchemaBuilder<T>;

  build(): SchemaResult<T>;
};

export function schema(version: string): SchemaBuilder<Record<never, never>> {
  const tables: TablesDef = {};
  const relations: RelationDef[] = [];

  const builder: SchemaBuilder<any> = {
    table(name, define) {
      tables[name] = define(t);
      return builder;
    },
    relation(fromTable, define) {
      relations.push(define(makeRelChain(fromTable)));
      return builder;
    },
    build() {
      return Object.freeze({ version, tables, relations, _db: undefined as any });
    },
  };

  return builder;
}

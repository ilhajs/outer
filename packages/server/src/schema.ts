import type { Generated } from "kysely";

// ── Column ─────────────────────────────────────────────────────────────────

export type SQLTypeMap = {
  serial: number;
  text: string;
  varchar: string;
  integer: number;
  boolean: boolean;
  timestamp: Date;
  jsonb: unknown;
  uuid: string;
};

export type SQLType = keyof SQLTypeMap;

// PK/HasDefault are tracked at the type level so `.resource()` can derive
// exact input/output types (serial PKs and defaulted columns are omitted
// from create inputs, the PK column drives get/update/delete `where` types).
export type ColumnDef<
  T extends SQLType = SQLType,
  Null extends boolean = boolean,
  PK extends boolean = boolean,
  HasDefault extends boolean = boolean,
> = {
  _type: T;
  _nullable: Null;
  _primaryKey: PK;
  _hasDefault: HasDefault;
  _unique: boolean;
  _default: string | null;
  _references: { table: string; column: string } | null;
  nullable(): ColumnDef<T, true, PK, HasDefault>;
  primaryKey(): ColumnDef<T, Null, true, HasDefault>;
  unique(): ColumnDef<T, Null, PK, HasDefault>;
  default(expr: string): ColumnDef<T, Null, PK, true>;
  references(table: string, column: string): ColumnDef<T, Null, PK, HasDefault>;
};

function makeCol<T extends SQLType>(type: T): ColumnDef<T, false, false, false> {
  const def: ColumnDef<T, false, false, false> = {
    _type: type,
    _nullable: false as const,
    _primaryKey: false as const,
    _hasDefault: false as const,
    _unique: false,
    _default: null,
    _references: null,
    nullable() {
      return { ...this, _nullable: true as const } as unknown as ColumnDef<T, true, false, false>;
    },
    primaryKey() {
      return { ...this, _primaryKey: true as const } as unknown as ColumnDef<T, false, true, false>;
    },
    unique() {
      return { ...this, _unique: true };
    },
    default(expr: string) {
      return { ...this, _default: expr, _hasDefault: true as const } as unknown as ColumnDef<
        T,
        false,
        false,
        true
      >;
    },
    references(table: string, column: string) {
      return { ...this, _references: { table, column } };
    },
  };
  return def;
}

export type TableBuilder = {
  serial(): ColumnDef<"serial", false, false, false>;
  text(): ColumnDef<"text", false, false, false>;
  varchar(): ColumnDef<"varchar", false, false, false>;
  integer(): ColumnDef<"integer", false, false, false>;
  boolean(): ColumnDef<"boolean", false, false, false>;
  timestamp(): ColumnDef<"timestamp", false, false, false>;
  jsonb(): ColumnDef<"jsonb", false, false, false>;
  uuid(): ColumnDef<"uuid", false, false, false>;
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

// serial columns are DB-generated and optional in both insert and select contexts.
// Columns with a DB-side default are wrapped in Kysely's `Generated<T>`: present on
// select, optional on insert (so callers needn't pass `createdAt`/`updatedAt`).
type InferRow<T extends Record<string, ColumnDef>> = {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? never
    : T[K]["_nullable"] extends false
      ? T[K]["_hasDefault"] extends true
        ? never
        : K
      : never]: SQLTypeMap[T[K]["_type"]];
} & {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? never
    : T[K]["_nullable"] extends false
      ? T[K]["_hasDefault"] extends true
        ? K
        : never
      : never]: Generated<SQLTypeMap[T[K]["_type"]]>;
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

type TimestampCols = {
  createdAt: ColumnDef<"timestamp", false, false, true>;
  updatedAt: ColumnDef<"timestamp", false, false, true>;
};

/** `createdAt` / `updatedAt` with `CURRENT_TIMESTAMP` defaults — spread into a `.table()` column object. */
export function timestamps(t: TableBuilder): TimestampCols {
  return {
    createdAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().default("CURRENT_TIMESTAMP"),
  };
}

// ── Auth tables ────────────────────────────────────────────────────────────

/**
 * The Better Auth core schema (`user`, `session`, `account`, `verification`)
 * plus the admin plugin's fields (`user.role/banned/banReason/banExpires`,
 * `session.impersonatedBy`). Email OTP needs no extra columns — it uses the
 * `verification` table. Registered via `schema().auth()`.
 */
function authTableDefs(t: TableBuilder) {
  return {
    user: {
      id: t.text().primaryKey(),
      name: t.text(),
      email: t.text().unique(),
      emailVerified: t.boolean().default("false"),
      image: t.text().nullable(),
      role: t.text().default("'user'"),
      banned: t.boolean().default("false"),
      banReason: t.text().nullable(),
      banExpires: t.timestamp().nullable(),
      ...timestamps(t),
    },
    session: {
      id: t.text().primaryKey(),
      expiresAt: t.timestamp(),
      token: t.text().unique(),
      ipAddress: t.text().nullable(),
      userAgent: t.text().nullable(),
      userId: t.text().references("user", "id"),
      impersonatedBy: t.text().nullable(),
      ...timestamps(t),
    },
    account: {
      id: t.text().primaryKey(),
      accountId: t.text(),
      providerId: t.text(),
      userId: t.text().references("user", "id"),
      accessToken: t.text().nullable(),
      refreshToken: t.text().nullable(),
      idToken: t.text().nullable(),
      accessTokenExpiresAt: t.timestamp().nullable(),
      refreshTokenExpiresAt: t.timestamp().nullable(),
      scope: t.text().nullable(),
      password: t.text().nullable(),
      ...timestamps(t),
    },
    verification: {
      id: t.text().primaryKey(),
      identifier: t.text(),
      value: t.text(),
      expiresAt: t.timestamp(),
      ...timestamps(t),
    },
  };
}

export type AuthTables = ReturnType<typeof authTableDefs>;

// ── File tables ────────────────────────────────────────────────────────────

/**
 * Metadata for blobs held in an object store (unstorage, S3, R2, …). `key` is the
 * storage key the bytes live under — Outer never puts the bytes themselves in
 * Postgres. Registered via `schema().files()`.
 */
function fileTableDef(t: TableBuilder, owned: boolean) {
  return {
    id: t.text().primaryKey(),
    /** Storage key the bytes live under — unique so a blob is never double-registered. */
    key: t.text().unique(),
    name: t.text(),
    /** MIME type as reported at upload time. */
    type: t.text(),
    size: t.integer(),
    ...(owned ? { userId: t.text().nullable().references("user", "id") } : {}),
    ...timestamps(t),
  };
}

type FileCols = {
  id: ColumnDef<"text", false, true, false>;
  key: ColumnDef<"text", false, false, false>;
  name: ColumnDef<"text", false, false, false>;
  type: ColumnDef<"text", false, false, false>;
  size: ColumnDef<"integer", false, false, false>;
} & TimestampCols;

type OwnerCol = { userId: ColumnDef<"text", true, false, false> };

/** Pivot row linking one `file` to one row of the attached table. */
type AttachmentCols = {
  id: ColumnDef<"text", false, true, false>;
  fileId: ColumnDef<"text", false, false, false>;
  entityId: ColumnDef<"text", false, false, false>;
  /** Free-form label so one table can hold several kinds of attachment ("avatar", "cover", …). */
  role: ColumnDef<"text", true, false, false>;
  /** Sort key for ordered galleries. */
  position: ColumnDef<"integer", false, false, true>;
} & TimestampCols;

function attachmentTableDef(t: TableBuilder, entityTable: string) {
  return {
    id: t.text().primaryKey(),
    fileId: t.text().references("file", "id"),
    entityId: t.text().references(entityTable, "id"),
    role: t.text().nullable(),
    position: t.integer().default("0"),
    ...timestamps(t),
  };
}

export type FilesOptions<Attach extends string = never> = {
  /**
   * Tables to link files to. Each name `x` gets a pivot table `x_file` and a
   * `manyToMany` relation in both directions, so `context.db.query` can traverse it.
   */
  attachTo?: readonly Attach[];
  /**
   * Adds `file.userId` referencing `user`. Defaults to `true`; requires `.auth()`.
   * Set to `false` for files with no per-user owner.
   */
  owner?: boolean;
};

export type FileTables<Attach extends string = never, Owned extends boolean = true> = Record<
  "file",
  Owned extends true ? FileCols & OwnerCol : FileCols
> & { [K in Attach as `${K}_file`]: AttachmentCols };

// ── Builder ────────────────────────────────────────────────────────────────

export type SchemaResult<T extends TablesDef> = {
  version: string;
  tables: T;
  relations: RelationDef[];
  _db: InferDB<T>;
};

type SchemaBuilder<T extends TablesDef> = {
  /**
   * Registers the Better Auth core tables (`user`, `session`, `account`,
   * `verification`) with the admin plugin's fields included, plus their
   * relations — see `AuthTables`. Extend `user` (or any auth table) by
   * re-declaring extra columns via `.table("user", ...)` after this call:
   * columns merge, with yours winning on name collisions.
   */
  auth(): SchemaBuilder<T & AuthTables>;

  /**
   * Registers a `file` metadata table for blobs kept in an object store — the bytes
   * stay in unstorage/S3, only the pointer and ownership live in Postgres.
   *
   * `attachTo` links files to existing tables: each name `x` adds a pivot table
   * `x_file` (`fileId`, `entityId`, `role`, `position`) plus `manyToMany` relations
   * both ways. `role` lets one table carry several kinds of attachment.
   *
   * ```ts
   * schema("1.1.0").auth().table("post", ...).files({ attachTo: ["post"] })
   * ```
   */
  files<Attach extends keyof T & string = never, Owned extends boolean = true>(
    options?: FilesOptions<Attach> & { owner?: Owned },
  ): SchemaBuilder<T & FileTables<Attach, Owned>>;

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
    auth() {
      for (const [name, cols] of Object.entries(authTableDefs(t))) {
        tables[name] = { ...tables[name], ...cols };
      }
      relations.push(
        makeRelChain("user").hasMany("session", { from: "id", to: "userId" }),
        makeRelChain("user").hasMany("account", { from: "id", to: "userId" }),
        makeRelChain("session").belongsTo("user", { from: "userId", to: "id" }),
        makeRelChain("account").belongsTo("user", { from: "userId", to: "id" }),
      );
      return builder;
    },
    files(options) {
      const owned = options?.owner ?? true;
      tables["file"] = { ...tables["file"], ...fileTableDef(t, owned) };
      if (owned) {
        relations.push(
          makeRelChain("user").hasMany("file", { from: "id", to: "userId" }),
          makeRelChain("file").belongsTo("user", { from: "userId", to: "id" }),
        );
      }
      for (const entity of options?.attachTo ?? []) {
        const pivot = `${entity}_file`;
        tables[pivot] = { ...tables[pivot], ...attachmentTableDef(t, entity) };
        relations.push(
          makeRelChain(entity).manyToMany("file", pivot, {
            from: "id",
            to: "id",
            pivotFrom: "entityId",
            pivotTo: "fileId",
          }),
          makeRelChain("file").manyToMany(entity, pivot, {
            from: "id",
            to: "id",
            pivotFrom: "fileId",
            pivotTo: "entityId",
          }),
        );
      }
      return builder;
    },
    // re-declaring a table merges columns (later wins), so auth tables can be extended
    table(name, define) {
      tables[name] = { ...tables[name], ...define(t) };
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

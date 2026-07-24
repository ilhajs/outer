import type { Generated } from "kysely";

// ── Column ─────────────────────────────────────────────────────────────────

export type SQLTypeMap = {
  serial: number;
  text: string;
  varchar: string;
  integer: number;
  /** 64-bit. Read back as a string — `bigint` overflows JS `number` past 2^53. */
  bigint: string;
  /** Exact numeric (`numeric`/`DECIMAL`). A string, so cents never round-trip through a float. */
  decimal: string;
  real: number;
  boolean: boolean;
  timestamp: Date;
  /** Calendar date with no time component. */
  date: Date;
  jsonb: unknown;
  uuid: string;
  /** Raw bytes (`bytea` / `BLOB`). */
  bytes: Uint8Array;
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
  Values extends string = string,
  Multiple extends boolean = boolean,
> = {
  _type: T;
  _nullable: Null;
  _primaryKey: PK;
  _hasDefault: HasDefault;
  _unique: boolean;
  /** Rendered for display/DDL by `renderDefault()`. `null` when the column has no default. */
  _default: ColumnDefault | null;
  _references: {
    table: string;
    column: string;
    onDelete?: ReferentialAction;
    onUpdate?: ReferentialAction;
  } | null;
  /** True when the column should get a non-unique index. Unique columns are already indexed. */
  _index: boolean;
  /** Allowed values, or `null` for an unconstrained column. Text-shaped columns only. */
  _enum: readonly Values[] | null;
  /** When true the column stores a comma-separated *set* of `_enum` values rather than one. */
  _multiple: boolean;
  nullable(): ColumnDef<T, true, PK, HasDefault, Values, Multiple>;
  primaryKey(): ColumnDef<T, Null, true, HasDefault, Values, Multiple>;
  unique(): ColumnDef<T, Null, PK, HasDefault, Values, Multiple>;
  /**
   * A literal default, quoted for you according to the column type — pass the
   * value you want, not SQL: `.default("user")`, `.default(false)`, `.default(0)`.
   * Use `.defaultSql()` for expressions like `CURRENT_TIMESTAMP`.
   */
  default(value: DefaultValue<T, Values, Multiple>): ColumnDef<T, Null, PK, true, Values, Multiple>;
  /** A raw SQL default expression, emitted verbatim: `.defaultSql("CURRENT_TIMESTAMP")`. */
  defaultSql(expr: string): ColumnDef<T, Null, PK, true, Values, Multiple>;
  /**
   * A foreign key. `onDelete`/`onUpdate` set the referential action — without
   * one, deleting a referenced row fails with an FK violation:
   *
   * ```ts
   * userId: t.text().references("user", "id", { onDelete: "cascade" })
   * ```
   */
  references(
    table: string,
    column: string,
    actions?: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction },
  ): ColumnDef<T, Null, PK, HasDefault, Values, Multiple>;
  /** Adds a non-unique index on this column. */
  index(): ColumnDef<T, Null, PK, HasDefault, Values, Multiple>;
  /**
   * Restricts the column to a fixed set of values, narrowing its TS type to the
   * union and making resource/admin inputs reject anything else.
   *
   * The stored SQL type is unchanged (still `text`/`varchar`) — the constraint
   * lives in Outer, not the database, so editing the value list never generates
   * a migration. `_admin.meta` reports it so a UI can render a select.
   *
   * ```ts
   * role: t.text().enum(["user", "admin"]).default("user")
   * ```
   */
  enum<const V extends readonly string[], M extends boolean = false>(
    values: V,
    options?: { multiple?: M },
  ): ColumnDef<T, Null, PK, HasDefault, V[number], M>;
};

/** What the database should do to referencing rows when the referenced row changes. */
export type ReferentialAction = "cascade" | "set null" | "restrict" | "no action";

/** A column default: either a literal value (quoted at DDL time) or raw SQL. */
export type ColumnDefault = { kind: "value"; value: unknown } | { kind: "sql"; sql: string };

/**
 * What `.default()` accepts for a column. Enum columns take one of their
 * declared values; a `{ multiple: true }` enum takes the comma-separated form.
 */
export type DefaultValue<
  T extends SQLType,
  Values extends string = string,
  Multiple extends boolean = false,
> = string extends Values ? SQLTypeMap[T] : Multiple extends true ? string : Values;

/**
 * Any column, whatever its narrowing. Constraint positions must use this rather
 * than bare `ColumnDef`: a column narrowed by `.enum()` has `Values` in both
 * covariant (`_enum`) and contravariant (`.default()` parameter) positions, so
 * it is not assignable to the alias's `string` default.
 */
export type AnyColumn = ColumnDef<any, any, any, any, any, any>;

/** Column types `.enum()` accepts — the value list is stored as text. */
export type EnumableType = "text" | "varchar";

/**
 * The TS type a column holds: its enum union when constrained to one value.
 *
 * A `{ multiple: true }` enum stores a comma-separated *set* in one text column
 * (Better Auth's own format for `user.role`), so its type stays `string` —
 * enumerating every legal combination as a union is combinatorial. Use
 * `parseSet()` / `hasRole()` to read one, and `toSet()` to build one.
 */
export type ColumnValue<C extends ColumnDef> =
  C extends ColumnDef<infer T, any, any, any, infer V, infer M>
    ? string extends V
      ? SQLTypeMap[T]
      : M extends true
        ? string
        : V
    : never;

/** Splits a `{ multiple: true }` column's stored value into its parts. */
export function parseSet(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

/** Joins values into the storage format a `{ multiple: true }` column expects. */
export function toSet(values: readonly string[]): string {
  return values.join(",");
}

const ENUMABLE_TYPES = new Set<string>(["text", "varchar"] satisfies EnumableType[]);

function makeCol<T extends SQLType>(type: T): ColumnDef<T, false, false, false> {
  const def: ColumnDef<T, false, false, false> = {
    _type: type,
    _nullable: false as const,
    _primaryKey: false as const,
    _hasDefault: false as const,
    _unique: false,
    _default: null,
    _references: null,
    _enum: null,
    _multiple: false,
    _index: false,
    nullable() {
      return { ...this, _nullable: true as const } as unknown as ColumnDef<T, true, false, false>;
    },
    primaryKey() {
      return { ...this, _primaryKey: true as const } as unknown as ColumnDef<T, false, true, false>;
    },
    unique() {
      return { ...this, _unique: true };
    },
    default(value: unknown) {
      return {
        ...this,
        _default: { kind: "value", value } satisfies ColumnDefault,
        _hasDefault: true as const,
      } as unknown as ColumnDef<T, false, false, true>;
    },
    defaultSql(expr: string) {
      return {
        ...this,
        _default: { kind: "sql", sql: expr } satisfies ColumnDefault,
        _hasDefault: true as const,
      } as unknown as ColumnDef<T, false, false, true>;
    },
    references(table: string, column: string, actions) {
      return { ...this, _references: { table, column, ...actions } };
    },
    index() {
      return { ...this, _index: true };
    },
    enum<const V extends readonly string[], M extends boolean = false>(
      values: V,
      options?: { multiple?: M },
    ) {
      if (!ENUMABLE_TYPES.has(this._type)) {
        throw new Error(`.enum() is only supported on text/varchar columns, got "${this._type}"`);
      }
      if (values.length === 0) throw new Error(".enum() requires at least one value");
      for (const value of values) {
        if (value.includes(",")) {
          throw new Error(
            `.enum() values cannot contain a comma (got "${value}") — commas separate the parts of a { multiple: true } column`,
          );
        }
      }
      return {
        ...this,
        _enum: values,
        _multiple: options?.multiple === true,
      } as unknown as ColumnDef<T, false, false, false, V[number], M>;
    },
  };
  return def;
}

export type TableBuilder = {
  serial(): ColumnDef<"serial", false, false, false>;
  text(): ColumnDef<"text", false, false, false>;
  varchar(): ColumnDef<"varchar", false, false, false>;
  integer(): ColumnDef<"integer", false, false, false>;
  bigint(): ColumnDef<"bigint", false, false, false>;
  decimal(): ColumnDef<"decimal", false, false, false>;
  real(): ColumnDef<"real", false, false, false>;
  boolean(): ColumnDef<"boolean", false, false, false>;
  timestamp(): ColumnDef<"timestamp", false, false, false>;
  date(): ColumnDef<"date", false, false, false>;
  jsonb(): ColumnDef<"jsonb", false, false, false>;
  uuid(): ColumnDef<"uuid", false, false, false>;
  bytes(): ColumnDef<"bytes", false, false, false>;
};

const t: TableBuilder = {
  serial: () => makeCol("serial"),
  text: () => makeCol("text"),
  varchar: () => makeCol("varchar"),
  integer: () => makeCol("integer"),
  bigint: () => makeCol("bigint"),
  decimal: () => makeCol("decimal"),
  real: () => makeCol("real"),
  boolean: () => makeCol("boolean"),
  timestamp: () => makeCol("timestamp"),
  date: () => makeCol("date"),
  jsonb: () => makeCol("jsonb"),
  uuid: () => makeCol("uuid"),
  bytes: () => makeCol("bytes"),
};

/**
 * Renders a default for DDL. Literals are quoted according to the column type,
 * so `.default("user")` becomes `'user'` and `.default(false)` becomes `false`
 * on Postgres / `0` on SQLite. Raw SQL passes through untouched.
 */
export function renderDefault(
  def: ColumnDefault,
  type: SQLType,
  kind: "postgres" | "sqlite",
): string {
  if (def.kind === "sql") return def.sql;
  const { value } = def;
  if (value === null) return "NULL";
  switch (type) {
    case "boolean":
      // SQLite has no boolean literal — it stores 1/0.
      return kind === "sqlite" ? (value ? "1" : "0") : value ? "true" : "false";
    case "serial":
    case "integer":
    case "real":
      return String(value);
    case "bigint":
    case "decimal":
      // Kept as a string end-to-end so precision never goes through a float.
      return quoteSql(String(value));
    case "timestamp":
    case "date":
      return quoteSql(value instanceof Date ? value.toISOString() : String(value));
    case "jsonb":
      return quoteSql(typeof value === "string" ? value : JSON.stringify(value));
    default:
      return quoteSql(String(value));
  }
}

/** Single-quoted SQL string literal with embedded quotes doubled. */
function quoteSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Human-readable form of a default, for `_admin.meta` and UI placeholders. */
export function displayDefault(def: ColumnDefault | null): string | null {
  if (!def) return null;
  if (def.kind === "sql") return def.sql;
  return def.value === null ? "null" : String(def.value);
}

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

export type TablesDef = Record<string, Record<string, AnyColumn>>;

// serial columns are DB-generated and optional in both insert and select contexts.
// Columns with a DB-side default are wrapped in Kysely's `Generated<T>`: present on
// select, optional on insert (so callers needn't pass `createdAt`/`updatedAt`).
type InferRow<T extends Record<string, AnyColumn>> = {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? never
    : T[K]["_nullable"] extends false
      ? T[K]["_hasDefault"] extends true
        ? never
        : K
      : never]: ColumnValue<T[K]>;
} & {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? never
    : T[K]["_nullable"] extends false
      ? T[K]["_hasDefault"] extends true
        ? K
        : never
      : never]: Generated<ColumnValue<T[K]>>;
} & {
  [K in keyof T as T[K]["_type"] extends "serial"
    ? K
    : T[K]["_nullable"] extends true
      ? K
      : never]?: ColumnValue<T[K]> | null;
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
    createdAt: t.timestamp().defaultSql("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().defaultSql("CURRENT_TIMESTAMP"),
  };
}

// ── Auth tables ────────────────────────────────────────────────────────────

/**
 * The Better Auth core schema (`user`, `session`, `account`, `verification`)
 * plus the admin plugin's fields (`user.role/banned/banReason/banExpires`,
 * `session.impersonatedBy`). Email OTP needs no extra columns — it uses the
 * `verification` table. Registered via `schema().auth()`.
 */
export type AuthOptions<Roles extends readonly string[] = readonly string[]> = {
  /**
   * The roles your app recognises. Each part of `user.role` is validated
   * against this list — a user may still hold several at once, since Better
   * Auth stores them comma-separated in the one column (`"admin,support"`).
   *
   * Left open when omitted, so any role name is accepted.
   */
  roles?: Roles;
  /**
   * Adds the `apikey` table for `@better-auth/api-key`, so long-lived bearer
   * tokens can authenticate as a user — MCP clients, CI, server-to-server.
   *
   * The plugin itself is a separate install and must also be passed to
   * `.auth({ plugins: [apiKey()] })` on the `Outer` instance:
   * `bun add @better-auth/api-key`.
   */
  apiKeys?: boolean;
};

/**
 * The `@better-auth/api-key` plugin's table, mirroring its own field
 * definitions (including rate-limit and refill bookkeeping). The plugin owns
 * these rows — Outer only declares the DDL so the migrator can create them.
 *
 * `referenceId` is the owning user's id; `key` is the hashed token.
 */
function apiKeyTableDef(t: TableBuilder) {
  return {
    id: t.text().primaryKey(),
    /** Names the plugin configuration a key belongs to when several are registered. */
    configId: t.text().default("default").index(),
    name: t.text().nullable(),
    /** Leading characters of the token, kept for display. */
    start: t.text().nullable(),
    prefix: t.text().nullable(),
    /** The hashed key. Indexed — every authenticated request looks up by it. */
    key: t.text().index(),
    /** The user the key authenticates as. */
    referenceId: t.text().index(),
    refillInterval: t.integer().nullable(),
    refillAmount: t.integer().nullable(),
    lastRefillAt: t.timestamp().nullable(),
    enabled: t.boolean().default(true),
    rateLimitEnabled: t.boolean().default(true),
    rateLimitTimeWindow: t.integer().nullable(),
    rateLimitMax: t.integer().nullable(),
    requestCount: t.integer().default(0),
    remaining: t.integer().nullable(),
    lastRequest: t.timestamp().nullable(),
    expiresAt: t.timestamp().nullable(),
    /** JSON-encoded permission map. */
    permissions: t.text().nullable(),
    /** JSON-encoded free-form metadata. */
    metadata: t.text().nullable(),
    ...timestamps(t),
  };
}

export type ApiKeyTable = { apikey: ReturnType<typeof apiKeyTableDef> };

function authTableDefs(t: TableBuilder, roles?: readonly string[]) {
  return {
    user: {
      id: t.text().primaryKey(),
      name: t.text(),
      email: t.text().unique(),
      emailVerified: t.boolean().default(false),
      image: t.text().nullable(),
      // Multi-valued: Better Auth's admin plugin stores several roles in this
      // one column as a comma-separated list ("admin,support"), and `hasRole`
      // reads it that way. Declaring `roles` validates each part, not the whole.
      role: (roles ? t.text().enum(roles, { multiple: true }) : t.text()).default("user"),
      banned: t.boolean().default(false),
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
      userId: t.text().references("user", "id", { onDelete: "cascade" }).index(),
      impersonatedBy: t.text().nullable(),
      ...timestamps(t),
    },
    account: {
      id: t.text().primaryKey(),
      accountId: t.text(),
      providerId: t.text(),
      userId: t.text().references("user", "id", { onDelete: "cascade" }).index(),
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

type AuthTableDefs = ReturnType<typeof authTableDefs>;

/** The Better Auth tables. `Role` narrows `user.role` when `.auth({ roles })` is used. */
export type AuthTables<Role extends string = string> = Omit<AuthTableDefs, "user"> & {
  user: Omit<AuthTableDefs["user"], "role"> & {
    role: ColumnDef<"text", false, false, true, Role>;
  };
};

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
    ...(owned
      ? { userId: t.text().nullable().references("user", "id", { onDelete: "set null" }).index() }
      : {}),
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
type AttachmentCols<EntityIdT extends SQLType = "text"> = {
  id: ColumnDef<"text", false, true, false>;
  fileId: ColumnDef<"text", false, false, false>;
  /** Same type as the attached table's primary key (`serial` PKs store as `integer`). */
  entityId: ColumnDef<EntityIdT, false, false, false>;
  /** Free-form label so one table can hold several kinds of attachment ("avatar", "cover", …). */
  role: ColumnDef<"text", true, false, false>;
  /** Sort key for ordered galleries. */
  position: ColumnDef<"integer", false, false, true>;
} & TimestampCols;

/**
 * The attached table's primary key, so `entityId` can mirror its type — an FK
 * between incompatible types (`text` → `integer`) fails at CREATE TABLE.
 * `serial` maps to `integer`: the pivot references values, it doesn't generate them.
 */
function entityPk(cols: Record<string, AnyColumn> | undefined) {
  const pk = Object.entries(cols ?? {}).find(([, col]) => col._primaryKey);
  if (!pk) {
    return { name: "id", type: "text" as SQLType };
  }
  const type = pk[1]._type as SQLType;
  return { name: pk[0], type: type === "serial" ? ("integer" as const) : type };
}

/** Maps an attached table's PK column type to the pivot's `entityId` type. */
type EntityIdType<Cols> = [
  {
    [K in keyof Cols]: Cols[K] extends ColumnDef<infer T2, any, true, any, any, any> ? T2 : never;
  }[keyof Cols],
] extends [infer PkT]
  ? [PkT] extends [never]
    ? "text"
    : PkT extends "serial"
      ? "integer"
      : PkT & SQLType
  : "text";

function attachmentTableDef(t: TableBuilder, entityTable: string, pk: ReturnType<typeof entityPk>) {
  return {
    id: t.text().primaryKey(),
    fileId: t.text().references("file", "id", { onDelete: "cascade" }).index(),
    entityId: t[pk.type]().references(entityTable, pk.name, { onDelete: "cascade" }).index(),
    role: t.text().nullable(),
    position: t.integer().default(0),
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

export type FileTables<
  T extends TablesDef = TablesDef,
  Attach extends keyof T & string = never,
  Owned extends boolean = true,
> = Record<"file", Owned extends true ? FileCols & OwnerCol : FileCols> & {
  [K in Attach as `${K}_file`]: AttachmentCols<EntityIdType<T[K]>>;
};

// ── Builder ────────────────────────────────────────────────────────────────

export type SchemaResult<T extends TablesDef> = {
  version: string;
  tables: T;
  relations: RelationDef[];
  _db: InferDB<T>;
};

/** Prefer `Overlay` columns on name collision (matches runtime merge: later wins). */
type MergeTableCols<Base, Overlay> = Omit<Base, keyof Overlay & keyof Base> & Overlay;

/** Deep-merge two table maps the way `.table()` / `.extend()` merge at runtime. */
type MergeTablesDef<Base extends TablesDef, Overlay extends TablesDef> = {
  [K in keyof Base | keyof Overlay]: K extends keyof Overlay
    ? K extends keyof Base
      ? MergeTableCols<Base[K], Overlay[K]>
      : Overlay[K]
    : K extends keyof Base
      ? Base[K]
      : never;
};

type SchemaBuilder<T extends TablesDef> = {
  /**
   * Registers the Better Auth core tables (`user`, `session`, `account`,
   * `verification`) with the admin plugin's fields included, plus their
   * relations — see `AuthTables`. Extend `user` (or any auth table) by
   * re-declaring extra columns via `.table("user", ...)` after this call:
   * columns merge, with yours winning on name collisions.
   *
   * `roles` declares the recognised role set — equivalent to re-declaring the
   * column with `.enum(roles, { multiple: true })`, but without restating its
   * default:
   *
   * ```ts
   * schema("1.0.0").auth({ roles: ["user", "admin", "support"] })
   * ```
   *
   * A user can hold several at once: Better Auth's admin plugin stores them
   * comma-separated in the single `role` column, so `"admin,support"` is valid
   * while `"admin,root"` is rejected. Omit `roles` to accept any name.
   */
  auth<const Roles extends readonly string[] = never, const Keys extends boolean = false>(
    options?: AuthOptions<Roles> & { apiKeys?: Keys },
  ): SchemaBuilder<
    T &
      AuthTables<[Roles] extends [never] ? string : Roles[number]> &
      (Keys extends true ? ApiKeyTable : Record<never, never>)
  >;

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
  ): SchemaBuilder<T & FileTables<T, Attach, Owned>>;

  table<Name extends string, Cols extends Record<string, AnyColumn>>(
    name: Name,
    define: (t: TableBuilder) => Cols,
  ): SchemaBuilder<MergeTablesDef<T, Record<Name, Cols>>>;

  relation(
    fromTable: keyof T & string,
    define: (rel: RelationChain) => RelationDef,
  ): SchemaBuilder<T>;

  /**
   * Deep-merges another schema's tables and relations into this builder.
   * Existing builder columns win on collision (same as re-declaring via
   * `.table()`). Relations are concatenated and deduped by identity.
   *
   * ```ts
   * const v1_1 = schema("1.1.0")
   *   .extend(v1_0)
   *   .table("post", (t) => ({ tags: t.text().nullable() }))
   *   .build();
   * ```
   */
  extend<TPrev extends TablesDef>(
    previous: SchemaResult<TPrev>,
  ): SchemaBuilder<MergeTablesDef<TPrev, T>>;

  build(): SchemaResult<T>;
};

export function schema(version: string): SchemaBuilder<Record<never, never>> {
  const tables: TablesDef = {};
  const relations: RelationDef[] = [];

  const builder: SchemaBuilder<any> = {
    auth(options) {
      for (const [name, cols] of Object.entries(authTableDefs(t, options?.roles))) {
        tables[name] = { ...tables[name], ...cols };
      }
      if (options?.apiKeys) {
        tables["apikey"] = { ...tables["apikey"], ...apiKeyTableDef(t) };
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
        const pk = entityPk(tables[entity]);
        tables[pivot] = { ...tables[pivot], ...attachmentTableDef(t, entity, pk) };
        relations.push(
          makeRelChain(entity).manyToMany("file", pivot, {
            from: pk.name,
            to: "id",
            pivotFrom: "entityId",
            pivotTo: "fileId",
          }),
          makeRelChain("file").manyToMany(entity, pivot, {
            from: "id",
            to: pk.name,
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
    extend(previous) {
      // Merge tables: previous tables are the base, current tables overlay
      for (const [name, cols] of Object.entries(previous.tables)) {
        tables[name] = { ...cols, ...tables[name] };
      }
      // Merge relations: add previous relations not already present
      const existing = new Set(
        relations.map((r) => `${r.kind}:${r.fromTable}:${r.toTable}:${r.fromCol}:${r.toCol}`),
      );
      for (const rel of previous.relations) {
        const key = `${rel.kind}:${rel.fromTable}:${rel.toTable}:${rel.fromCol}:${rel.toCol}`;
        if (!existing.has(key)) {
          relations.push(rel);
          existing.add(key);
        }
      }
      return builder;
    },
    build() {
      return Object.freeze({ version, tables, relations, _db: undefined as any });
    },
  };

  return builder;
}

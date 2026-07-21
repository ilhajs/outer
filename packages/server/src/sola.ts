import { ORPCError } from "@orpc/client";
import { Kysely, sql } from "kysely";

import { LiveProvider } from "./live";
import { RelationDef, TablesDef } from "./schema";

// ── Where ──────────────────────────────────────────────────────────────────

type NullFilter = { isNull?: boolean };

type StringFilter = {
  equals?: string;
  not?: string;
  in?: string[];
  notIn?: string[];
  contains?: string;
  startsWith?: string;
  endsWith?: string;
} & NullFilter;
type NumberFilter = {
  equals?: number;
  not?: number;
  in?: number[];
  notIn?: number[];
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
} & NullFilter;
type BooleanFilter = { equals?: boolean; not?: boolean } & NullFilter;
type DateFilter = {
  equals?: Date;
  not?: Date;
  lt?: Date;
  lte?: Date;
  gt?: Date;
  gte?: Date;
} & NullFilter;

type FieldFilter<T> =
  NonNullable<T> extends string
    ? StringFilter
    : NonNullable<T> extends number
      ? NumberFilter
      : NonNullable<T> extends boolean
        ? BooleanFilter
        : NonNullable<T> extends Date
          ? DateFilter
          : { equals?: T; not?: T };

export type WhereClause<T> = { [K in keyof T]?: T[K] | FieldFilter<T[K]> } & {
  AND?: WhereClause<T>[];
  OR?: WhereClause<T>[];
  NOT?: WhereClause<T>;
};

// ── OrderBy / Select ───────────────────────────────────────────────────────

export type OrderByClause<T> = { [K in keyof T]?: "asc" | "desc" };
type SelectClause<T> = { [K in keyof T]?: boolean };

// ── Include ────────────────────────────────────────────────────────────────

type NestedArgs<T = any> = {
  where?: WhereClause<T>;
  select?: SelectClause<T>;
  orderBy?: OrderByClause<T>[];
  take?: number;
  skip?: number;
};

// ── Find args ──────────────────────────────────────────────────────────────

type FindArgs<T, TRelated extends Record<string, any> = Record<string, any>> = {
  where?: WhereClause<T>;
  select?: SelectClause<T>;
  include?: {
    [K in keyof TRelated]?: boolean | NestedArgs<TRelated[K] extends (infer U)[] ? U : TRelated[K]>;
  };
  orderBy?: OrderByClause<T>[];
  take?: number;
  skip?: number;
};

// ── Pagination ─────────────────────────────────────────────────────────────

type PaginateArgs<T> = Omit<FindArgs<T>, "take" | "skip"> & {
  orderBy: OrderByClause<T>[];
  take: number;
  // offset
  skip?: number;
  // cursor
  after?: string;
  before?: string;
};

export type PaginationMeta = {
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

export type PaginationResult<T> = {
  data: T[];
  pagination: PaginationMeta;
};

// ── Model ──────────────────────────────────────────────────────────────────

type UniqueWhere<T> = { [K in keyof T]?: T[K] };

/** Options accepted by every `live*` method. */
export type LiveOptions = {
  /**
   * Ends the stream and releases the underlying subscription. Pass a
   * procedure's `signal` so a disconnecting client tears the query down.
   */
  signal?: AbortSignal | undefined;
};

export type SolaModel<T> = {
  findMany(args?: FindArgs<T>): Promise<T[]>;
  findFirst(args?: FindArgs<T>): Promise<T | null>;
  findUnique(args: { where: UniqueWhere<T> }): Promise<T>;
  count(args?: { where?: WhereClause<T> }): Promise<number>;
  exists(args?: { where?: WhereClause<T> }): Promise<boolean>;
  paginate(args: PaginateArgs<T>): Promise<PaginationResult<T>>;
  /**
   * Same query as `findMany`, as a stream: the full result set now, then again
   * on every change that affects it. Requires a dialect with a `LiveProvider`
   * (`pglite()` ships one).
   *
   * `include` is not supported — relations are loaded as separate queries, so
   * one subscription cannot cover them.
   */
  live(
    args?: Omit<FindArgs<T>, "include">,
    options?: LiveOptions,
  ): AsyncGenerator<T[], void, undefined>;
  /** `count` as a stream — emits the new total on every change. */
  liveCount(
    args?: { where?: WhereClause<T> },
    options?: LiveOptions,
  ): AsyncGenerator<number, void, undefined>;
  /** `exists` as a stream — emits on every change that flips the answer. */
  liveExists(
    args?: { where?: WhereClause<T> },
    options?: LiveOptions,
  ): AsyncGenerator<boolean, void, undefined>;
};

export type Sola<TDB> = { [K in keyof TDB]: SolaModel<TDB[K]> };

// ── Where builder ──────────────────────────────────────────────────────────

/** Escapes LIKE wildcards (`%`, `_`) and the escape char itself so user input matches literally. */
function escapeLike(val: unknown): string {
  return String(val).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * LIKE with an explicit `ESCAPE '\'` clause — Postgres defaults to backslash
 * escaping but SQLite has no default escape character, so it must be spelled out.
 */
function likeExpr(field: string, pattern: string): any {
  return sql`${sql.ref(field)} like ${pattern} escape '\\'`;
}

function applyWhere({ qb, where }: { qb: any; where: Record<string, any> }): any {
  for (const [field, filter] of Object.entries(where)) {
    if (filter === undefined) continue;

    if (field === "AND" && Array.isArray(filter)) {
      for (const clause of filter) qb = applyWhere({ qb, where: clause });
      continue;
    }

    if (field === "OR" && Array.isArray(filter)) {
      qb = qb.where((eb: any) =>
        eb.or(
          filter.map((clause: any) => {
            const conditions = clauseToExprs({ eb, clause });
            return conditions.length > 0 ? eb.and(conditions) : eb.lit(1);
          }),
        ),
      );
      continue;
    }

    if (field === "NOT") {
      qb = qb.where((eb: any) => {
        const conditions = clauseToExprs({ eb, clause: filter });
        return eb.not(conditions.length > 0 ? eb.and(conditions) : eb.lit(1));
      });
      continue;
    }

    if (
      filter !== null &&
      typeof filter === "object" &&
      !Array.isArray(filter) &&
      !(filter instanceof Date)
    ) {
      for (const [op, val] of Object.entries(filter as Record<string, any>)) {
        qb = applyOp({ qb, field, op, val });
      }
    } else {
      qb = qb.where(field, "=", filter);
    }
  }
  return qb;
}

/**
 * Expression-builder twin of `applyWhere` for full clauses — handles the
 * `AND`/`OR`/`NOT` combinators at the clause level (so they nest arbitrarily
 * inside `OR`/`NOT`) and delegates plain fields to `fieldToExprs`.
 */
function clauseToExprs({ eb, clause }: { eb: any; clause: Record<string, any> }): any[] {
  const exprs: any[] = [];
  for (const [field, filter] of Object.entries(clause)) {
    if (filter === undefined) continue;
    if (field === "AND" && Array.isArray(filter)) {
      const inner = filter.flatMap((c: any) => clauseToExprs({ eb, clause: c }));
      exprs.push(inner.length > 0 ? eb.and(inner) : eb.lit(1));
    } else if (field === "OR" && Array.isArray(filter)) {
      exprs.push(
        eb.or(
          filter.map((c: any) => {
            const cs = clauseToExprs({ eb, clause: c });
            return cs.length > 0 ? eb.and(cs) : eb.lit(1);
          }),
        ),
      );
    } else if (field === "NOT") {
      const cs = clauseToExprs({ eb, clause: filter });
      exprs.push(eb.not(cs.length > 0 ? eb.and(cs) : eb.lit(1)));
    } else {
      exprs.push(...fieldToExprs({ eb, field, filter }));
    }
  }
  return exprs;
}

function fieldToExprs({ eb, field, filter }: { eb: any; field: string; filter: any }): any[] {
  if (filter === null || filter === undefined) return [];
  if (typeof filter !== "object" || filter instanceof Date || Array.isArray(filter)) {
    return [eb(field, "=", filter)];
  }
  const exprs: any[] = [];
  for (const [op, val] of Object.entries(filter as Record<string, any>)) {
    exprs.push(opToExpr({ eb, field, op, val }));
  }
  return exprs;
}

function opToExpr({ eb, field, op, val }: { eb: any; field: string; op: string; val: any }): any {
  switch (op) {
    case "equals":
      return eb(field, "=", val);
    case "not":
      return eb(field, "!=", val);
    case "in":
      return eb(field, "in", val);
    case "notIn":
      return eb(field, "not in", val);
    case "lt":
      return eb(field, "<", val);
    case "lte":
      return eb(field, "<=", val);
    case "gt":
      return eb(field, ">", val);
    case "gte":
      return eb(field, ">=", val);
    case "contains":
      return likeExpr(field, `%${escapeLike(val)}%`);
    case "startsWith":
      return likeExpr(field, `${escapeLike(val)}%`);
    case "endsWith":
      return likeExpr(field, `%${escapeLike(val)}`);
    case "isNull":
      return val ? eb(field, "is", null) : eb(field, "is not", null);
    default:
      return eb(field, "=", val);
  }
}

function applyOp({ qb, field, op, val }: { qb: any; field: string; op: string; val: any }): any {
  switch (op) {
    case "equals":
      return qb.where(field, "=", val);
    case "not":
      return qb.where(field, "!=", val);
    case "in":
      return qb.where(field, "in", val);
    case "notIn":
      return qb.where(field, "not in", val);
    case "lt":
      return qb.where(field, "<", val);
    case "lte":
      return qb.where(field, "<=", val);
    case "gt":
      return qb.where(field, ">", val);
    case "gte":
      return qb.where(field, ">=", val);
    case "contains":
      return qb.where(likeExpr(field, `%${escapeLike(val)}%`));
    case "startsWith":
      return qb.where(likeExpr(field, `${escapeLike(val)}%`));
    case "endsWith":
      return qb.where(likeExpr(field, `%${escapeLike(val)}`));
    case "isNull":
      return val ? qb.where(field, "is", null) : qb.where(field, "is not", null);
    default:
      return qb.where(field, "=", val);
  }
}

// ── Include fetcher ────────────────────────────────────────────────────────

async function fetchRelation({
  db,
  tables,
  rel,
  mainRows,
  args,
}: {
  db: Kysely<any>;
  tables: TablesDef;
  rel: RelationDef;
  mainRows: any[];
  args: NestedArgs;
}): Promise<{ byKey: Map<any, any[]>; isArray: boolean }> {
  const keyValues = [...new Set(mainRows.map((r) => r[rel.fromCol]).filter((v) => v != null))];
  if (keyValues.length === 0) {
    return { byKey: new Map(), isArray: rel.kind === "hasMany" || rel.kind === "manyToMany" };
  }

  const isArray = rel.kind === "hasMany" || rel.kind === "manyToMany";

  if (rel.kind === "manyToMany") {
    if (!rel.pivotTable)
      throw new Error(
        `manyToMany relation from ${rel.fromTable} to ${rel.toTable} is missing pivotTable`,
      );

    // Join pivot → target, carry the source key for grouping
    const pivot = rel.pivotTable;
    const pivotFromCol = rel.pivotFromCol ?? rel.fromCol;
    const pivotToCol = rel.pivotToCol ?? rel.toCol;
    let qb: any = db
      .selectFrom(pivot)
      .innerJoin(rel.toTable, `${rel.toTable}.${rel.toCol}`, `${pivot}.${pivotToCol}`)
      .where(`${pivot}.${pivotFromCol}`, "in", keyValues);

    if (args.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
    if (args.orderBy) {
      for (const ob of args.orderBy) {
        for (const [col, dir] of Object.entries(ob)) {
          if (dir) qb = qb.orderBy(`${rel.toTable}.${col}`, dir);
        }
      }
    }
    if (args.take !== undefined) qb = qb.limit(args.take);
    if (args.skip !== undefined) qb = qb.offset(args.skip);

    const cols = args.select
      ? Object.entries(args.select)
          .filter(([, v]) => v)
          .map(([k]) => `${rel.toTable}.${k}`)
      : Object.keys(tables[rel.toTable] ?? {}).map((k) => `${rel.toTable}.${k} as ${k}`);
    // Always include the pivot key for grouping; select target columns
    qb = qb.select([`${pivot}.${pivotFromCol} as __pivot_key`, ...cols]);

    const rows: any[] = await qb.execute();

    const byKey = new Map<any, any[]>();
    for (const row of rows) {
      const key = row["__pivot_key"];
      delete row["__pivot_key"];
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
    return { byKey, isArray };
  }

  let qb: any = db.selectFrom(rel.toTable).where(rel.toCol, "in", keyValues);

  if (args.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
  if (args.orderBy) {
    for (const ob of args.orderBy) {
      for (const [col, dir] of Object.entries(ob)) {
        if (dir) qb = qb.orderBy(col, dir);
      }
    }
  }
  if (args.take !== undefined) qb = qb.limit(args.take);
  if (args.skip !== undefined) qb = qb.offset(args.skip);

  const cols = args.select
    ? Object.entries(args.select)
        .filter(([, v]) => v)
        .map(([k]) => k)
    : [];
  qb = cols.length > 0 ? qb.select(cols) : qb.selectAll();

  const rows: any[] = await qb.execute();

  const byKey = new Map<any, any[]>();
  for (const row of rows) {
    const key = row[rel.toCol];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  return { byKey, isArray };
}

// ── Cursor helpers ─────────────────────────────────────────────────────────

function encodeCursor({ row, orderBy }: { row: any; orderBy: OrderByClause<any>[] }): string {
  const pos: Record<string, any> = {};
  for (const ob of orderBy) {
    for (const col of Object.keys(ob)) pos[col] = row[col];
  }
  return Buffer.from(JSON.stringify(pos)).toString("base64");
}

function decodeCursor(cursor: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid pagination cursor", cause: error });
  }
}

function applyCursorWhere({
  qb,
  cursor,
  orderBy,
  direction,
}: {
  qb: any;
  cursor: Record<string, any>;
  orderBy: OrderByClause<any>[];
  direction: "after" | "before";
}): any {
  const entries = orderBy.flatMap((ob) => Object.entries(ob)) as [string, "asc" | "desc"][];
  if (entries.length === 0) return qb;

  // Correct keyset pagination: (c1 > v1) OR (c1 = v1 AND c2 > v2) OR ...
  // ">" is relative to direction: after+asc or before+desc uses ">", after+desc or before+asc uses "<"
  const branches = entries.map(([pivotCol, _], i) => {
    // equality conditions for all columns before the pivot
    const equalities = entries.slice(0, i).map(([col]) => ({ col, val: cursor[col] }));
    const [pivotC, pivotDir] = entries[i]!;
    const forward = direction === "after" ? pivotDir === "asc" : pivotDir === "desc";
    const pivotOp: ">" | "<" = forward ? ">" : "<";
    return { equalities, pivotCol: pivotC, pivotOp, pivotVal: cursor[pivotCol] };
  });

  return qb.where((eb: any) =>
    eb.or(
      branches.map(({ equalities, pivotCol, pivotOp, pivotVal }) => {
        const parts: any[] = equalities.map(({ col, val }) => eb(col, "=", val));
        parts.push(eb(pivotCol, pivotOp, pivotVal));
        return parts.length === 1 ? parts[0] : eb.and(parts);
      }),
    ),
  );
}

// ── Model factory ──────────────────────────────────────────────────────────

function createModel<T>({
  db,
  tableName,
  tableRelations,
  tables,
  live,
}: {
  db: Kysely<any>;
  tableName: string;
  tableRelations: RelationDef[];
  tables: TablesDef;
  live: LiveProvider | undefined;
}): SolaModel<T> {
  /** Builds the `findMany` query. Shared with `live()`, so a live stream and a one-shot read can never drift apart. */
  function buildSelect(args: FindArgs<T> | undefined, limitOverride?: number): any {
    let qb: any = db.selectFrom(tableName);

    if (args?.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
    if (args?.orderBy) {
      for (const ob of args.orderBy) {
        for (const [col, dir] of Object.entries(ob)) {
          if (dir) qb = qb.orderBy(col, dir);
        }
      }
    }

    const limit = limitOverride ?? args?.take;
    if (limit !== undefined) qb = qb.limit(limit);
    if (args?.skip !== undefined) qb = qb.offset(args.skip);

    const cols = args?.select
      ? Object.entries(args.select)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [];
    return cols.length > 0 ? qb.select(cols) : qb.selectAll();
  }

  /** Builds the `count` query — also shared, for the same reason. */
  function buildCount(where: WhereClause<T> | undefined): any {
    let qb: any = db.selectFrom(tableName).select((eb: any) => eb.fn.countAll().as("n"));
    if (where) qb = applyWhere({ qb, where: where as Record<string, any> });
    return qb;
  }

  /**
   * Subscribes to a built query, mapping each result set with `map`.
   * Fails loudly when the dialect has no provider — a live query that silently
   * degrades to a one-shot read is worse than one that refuses to start.
   */
  function subscribe<R>(
    qb: any,
    map: (rows: Record<string, unknown>[]) => R,
    options?: LiveOptions,
  ): AsyncGenerator<R, void, undefined> {
    if (!live) {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: `${tableName}.live(): the configured dialect has no live-query provider. Use pglite(), or pass \`live\` alongside \`dialect\` in \`new Outer({ db })\`.`,
      });
    }
    const { sql, parameters } = qb.compile();
    const stream = live.subscribe({ sql, parameters, signal: options?.signal });
    // A real generator, not a bare iterable — see `liveIterable`.
    return (async function* () {
      for await (const rows of stream) yield map(rows);
    })();
  }

  async function run(args: FindArgs<T> | undefined, limitOverride?: number): Promise<T[]> {
    const qb = buildSelect(args, limitOverride);
    const rows: any[] = await qb.execute();
    if (!args?.include || rows.length === 0) return rows as T[];

    for (const [key, includeArgs] of Object.entries(args.include)) {
      if (!includeArgs) continue;
      const rel = tableRelations.find((r) => r.toTable === key);
      if (!rel) continue;

      const nested: NestedArgs = includeArgs === true ? {} : (includeArgs as NestedArgs);
      const { byKey, isArray } = await fetchRelation({
        db,
        tables,
        rel,
        mainRows: rows,
        args: nested,
      });

      for (const row of rows) {
        const fk = row[rel.fromCol];
        const related = byKey.get(fk) ?? [];
        row[key] = isArray ? related : (related[0] ?? null);
      }
    }

    return rows as T[];
  }

  return {
    findMany: (args) => run(args),
    findFirst: async (args) => (await run(args, 1))[0] ?? null,
    findUnique: async ({ where }) => {
      let qb: any = db.selectFrom(tableName).selectAll();
      qb = applyWhere({ qb, where: where as Record<string, any> });
      const row = await qb.executeTakeFirst();
      if (row == null) {
        throw new ORPCError("NOT_FOUND", { message: `${tableName}: record not found` });
      }
      return row as T;
    },
    exists: async (args) => {
      let qb: any = db
        .selectFrom(tableName)
        .select((eb: any) => eb.lit(1).as("x"))
        .limit(1);
      if (args?.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
      const row = await qb.executeTakeFirst();
      return row != null;
    },
    count: async (args) => {
      const row = await buildCount(args?.where).executeTakeFirstOrThrow();
      return Number(row.n);
    },
    live: (args, options) => {
      if (args && "include" in args && (args as FindArgs<T>).include) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${tableName}.live(): \`include\` is not supported — relations are loaded as separate queries, which a single subscription cannot watch. Subscribe to the related table separately.`,
        });
      }
      return subscribe(buildSelect(args), (rows) => rows as T[], options);
    },
    liveCount: (args, options) =>
      subscribe(buildCount(args?.where), (rows) => Number((rows[0] as any)?.n ?? 0), options),
    liveExists: (args, options) =>
      subscribe(buildCount(args?.where), (rows) => Number((rows[0] as any)?.n ?? 0) > 0, options),
    paginate: async (args: PaginateArgs<T>): Promise<PaginationResult<T>> => {
      const { take, skip, after, before, orderBy, where, ...rest } = args;

      // Count (same where, no pagination)
      const count = await (async () => {
        let qb: any = db.selectFrom(tableName).select((eb: any) => eb.fn.countAll().as("n"));
        if (where) qb = applyWhere({ qb, where: where as Record<string, any> });
        const row = await qb.executeTakeFirstOrThrow();
        return Number(row.n);
      })();

      // Offset pagination when skip is explicitly provided
      if (skip !== undefined) {
        const data = await run({ ...rest, where, orderBy, take, skip } as FindArgs<T>);
        return {
          data,
          pagination: {
            count,
            hasNext: skip + data.length < count,
            hasPrevious: skip > 0,
            startCursor: null,
            endCursor: null,
          },
        };
      }

      // Cursor pagination (first page or navigating with after/before)
      const direction = before !== undefined ? "before" : "after";

      let qb: any = db.selectFrom(tableName);
      if (where) qb = applyWhere({ qb, where: where as Record<string, any> });

      if (after !== undefined) {
        qb = applyCursorWhere({ qb, cursor: decodeCursor(after), orderBy, direction: "after" });
      } else if (before !== undefined) {
        qb = applyCursorWhere({ qb, cursor: decodeCursor(before), orderBy, direction: "before" });
      }

      const effectiveOrder =
        direction === "before"
          ? orderBy.map((ob) =>
              Object.fromEntries(
                Object.entries(ob).map(([k, v]) => [k, v === "asc" ? "desc" : "asc"]),
              ),
            )
          : orderBy;
      for (const ob of effectiveOrder) {
        for (const [col, dir] of Object.entries(ob)) {
          if (dir) qb = qb.orderBy(col, dir);
        }
      }
      qb = qb.limit(take + 1).selectAll();
      let rows: any[] = await qb.execute();

      const hasMore = rows.length > take;
      if (hasMore) rows = rows.slice(0, take);
      if (direction === "before") rows = rows.reverse();

      return {
        data: rows as T[],
        pagination: {
          count,
          hasNext: direction === "after" ? hasMore : after !== undefined,
          hasPrevious: direction === "before" ? hasMore : before !== undefined,
          startCursor: rows.length > 0 ? encodeCursor({ row: rows[0], orderBy }) : null,
          endCursor: rows.length > 0 ? encodeCursor({ row: rows[rows.length - 1], orderBy }) : null,
        },
      };
    },
  };
}

// ── Public factory ─────────────────────────────────────────────────────────

export function createSola<TDB>({
  db,
  tables,
  relations,
  live,
}: {
  db: Kysely<any>;
  tables: TablesDef;
  relations: RelationDef[];
  /** Omitted for dialects without one — `live*()` then throws rather than degrading. */
  live?: LiveProvider | undefined;
}): Sola<TDB> {
  const sola: any = {};
  for (const tableName of Object.keys(tables)) {
    sola[tableName] = createModel({
      db,
      tableName,
      tableRelations: relations.filter((r) => r.fromTable === tableName),
      tables,
      live,
    });
  }
  return sola as Sola<TDB>;
}

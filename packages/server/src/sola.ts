import { Kysely } from "kysely";
import { RelationDef, TablesDef } from "./schema";

// ── Where ──────────────────────────────────────────────────────────────────

type NullFilter   = { isNull?: boolean };

type StringFilter = {
  equals?: string; not?: string; in?: string[]; notIn?: string[];
  contains?: string; startsWith?: string; endsWith?: string;
} & NullFilter;
type NumberFilter = {
  equals?: number; not?: number; in?: number[]; notIn?: number[];
  lt?: number; lte?: number; gt?: number; gte?: number;
} & NullFilter;
type BooleanFilter = { equals?: boolean; not?: boolean } & NullFilter;
type DateFilter   = { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date } & NullFilter;

type FieldFilter<T> =
  NonNullable<T> extends string  ? StringFilter :
  NonNullable<T> extends number  ? NumberFilter :
  NonNullable<T> extends boolean ? BooleanFilter :
  NonNullable<T> extends Date    ? DateFilter :
  { equals?: T; not?: T };

export type WhereClause<T> =
  { [K in keyof T]?: T[K] | FieldFilter<T[K]> }
  & { AND?: WhereClause<T>[]; OR?: WhereClause<T>[]; NOT?: WhereClause<T> };

// ── OrderBy / Select ───────────────────────────────────────────────────────

export type OrderByClause<T> = { [K in keyof T]?: "asc" | "desc" };
type SelectClause<T>         = { [K in keyof T]?: boolean };

// ── Include ────────────────────────────────────────────────────────────────

type NestedArgs<T = any> = {
  where?:   WhereClause<T>;
  select?:  SelectClause<T>;
  orderBy?: OrderByClause<T>[];
  take?:    number;
  skip?:    number;
};

// ── Find args ──────────────────────────────────────────────────────────────

type FindArgs<T, TRelated extends Record<string, any> = Record<string, any>> = {
  where?:   WhereClause<T>;
  select?:  SelectClause<T>;
  include?: { [K in keyof TRelated]?: boolean | NestedArgs<TRelated[K] extends (infer U)[] ? U : TRelated[K]> };
  orderBy?: OrderByClause<T>[];
  take?:    number;
  skip?:    number;
};

// ── Pagination ─────────────────────────────────────────────────────────────

type PaginateArgs<T> = Omit<FindArgs<T>, "take" | "skip"> & {
  orderBy: OrderByClause<T>[];
  take:    number;
  // offset
  skip?:   number;
  // cursor
  after?:  string;
  before?: string;
};

export type PaginationMeta = {
  count:       number;
  hasNext:     boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor:   string | null;
};

export type PaginationResult<T> = {
  data:       T[];
  pagination: PaginationMeta;
};

// ── Model ──────────────────────────────────────────────────────────────────

type UniqueWhere<T> = { [K in keyof T]?: T[K] };

export type SolaModel<T> = {
  findMany(args?: FindArgs<T>): Promise<T[]>;
  findFirst(args?: FindArgs<T>): Promise<T | null>;
  findUnique(args: { where: UniqueWhere<T> }): Promise<T>;
  count(args?: { where?: WhereClause<T> }): Promise<number>;
  exists(args?: { where?: WhereClause<T> }): Promise<boolean>;
  paginate(args: PaginateArgs<T>): Promise<PaginationResult<T>>;
};

export type Sola<TDB> = { [K in keyof TDB]: SolaModel<TDB[K]> };

// ── Where builder ──────────────────────────────────────────────────────────

function applyWhere({ qb, where }: { qb: any; where: Record<string, any> }): any {
  for (const [field, filter] of Object.entries(where)) {
    if (filter === undefined) continue;

    if (field === "AND" && Array.isArray(filter)) {
      for (const clause of filter) qb = applyWhere({ qb, where: clause });
      continue;
    }

    if (field === "OR" && Array.isArray(filter)) {
      qb = qb.where((eb: any) =>
        eb.or(filter.map((clause: any) => {
          const conditions: any[] = [];
          for (const [f, v] of Object.entries(clause as Record<string, any>)) {
            conditions.push(...fieldToExprs({ eb, field: f, filter: v }));
          }
          return conditions.length > 0 ? eb.and(conditions) : eb.lit(1);
        }))
      );
      continue;
    }

    if (field === "NOT") {
      qb = qb.where((eb: any) => {
        const conditions: any[] = [];
        for (const [f, v] of Object.entries(filter as Record<string, any>)) {
          conditions.push(...fieldToExprs({ eb, field: f, filter: v }));
        }
        return eb.not(conditions.length > 0 ? eb.and(conditions) : eb.lit(1));
      });
      continue;
    }

    if (filter !== null && typeof filter === "object" && !Array.isArray(filter) && !(filter instanceof Date)) {
      for (const [op, val] of Object.entries(filter as Record<string, any>)) {
        qb = applyOp({ qb, field, op, val });
      }
    } else {
      qb = qb.where(field, "=", filter);
    }
  }
  return qb;
}

function fieldToExprs({ eb, field, filter }: { eb: any; field: string; filter: any }): any[] {
  if (filter === null || filter === undefined) return [];
  if (typeof filter !== "object" || filter instanceof Date || Array.isArray(filter)) {
    return [eb(field, "=", filter)];
  }
  const exprs: any[] = [];
  for (const [op, val] of Object.entries(filter as Record<string, any>)) {
    if (op === "AND" && Array.isArray(val)) {
      const inner = val.flatMap((clause: any) =>
        Object.entries(clause as Record<string, any>).flatMap(([f, v]) => fieldToExprs({ eb, field: f, filter: v }))
      );
      exprs.push(eb.and(inner));
    } else if (op === "OR" && Array.isArray(val)) {
      exprs.push(eb.or(val.map((clause: any) => {
        const cs = Object.entries(clause as Record<string, any>).flatMap(([f, v]) => fieldToExprs({ eb, field: f, filter: v }));
        return cs.length > 0 ? eb.and(cs) : eb.lit(1);
      })));
    } else if (op === "NOT") {
      const cs = Object.entries(val as Record<string, any>).flatMap(([f, v]) => fieldToExprs({ eb, field: f, filter: v }));
      exprs.push(eb.not(cs.length > 0 ? eb.and(cs) : eb.lit(1)));
    } else {
      exprs.push(opToExpr({ eb, field, op, val }));
    }
  }
  return exprs;
}

function opToExpr({ eb, field, op, val }: { eb: any; field: string; op: string; val: any }): any {
  switch (op) {
    case "equals":     return eb(field, "=", val);
    case "not":        return eb(field, "!=", val);
    case "in":         return eb(field, "in", val);
    case "notIn":      return eb(field, "not in", val);
    case "lt":         return eb(field, "<", val);
    case "lte":        return eb(field, "<=", val);
    case "gt":         return eb(field, ">", val);
    case "gte":        return eb(field, ">=", val);
    case "contains":   return eb(field, "like", `%${val}%`);
    case "startsWith": return eb(field, "like", `${val}%`);
    case "endsWith":   return eb(field, "like", `%${val}`);
    case "isNull":     return val ? eb(field, "is", null) : eb(field, "is not", null);
    default:           return eb(field, "=", val);
  }
}

function applyOp({ qb, field, op, val }: { qb: any; field: string; op: string; val: any }): any {
  switch (op) {
    case "equals":     return qb.where(field, "=", val);
    case "not":        return qb.where(field, "!=", val);
    case "in":         return qb.where(field, "in", val);
    case "notIn":      return qb.where(field, "not in", val);
    case "lt":         return qb.where(field, "<", val);
    case "lte":        return qb.where(field, "<=", val);
    case "gt":         return qb.where(field, ">", val);
    case "gte":        return qb.where(field, ">=", val);
    case "contains":   return qb.where(field, "like", `%${val}%`);
    case "startsWith": return qb.where(field, "like", `${val}%`);
    case "endsWith":   return qb.where(field, "like", `%${val}`);
    case "isNull":     return val ? qb.where(field, "is", null) : qb.where(field, "is not", null);
    default:           return qb.where(field, "=", val);
  }
}

// ── Include fetcher ────────────────────────────────────────────────────────

async function fetchRelation({ db, tables, rel, mainRows, args }: {
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
    if (!rel.pivotTable) throw new Error(`manyToMany relation from ${rel.fromTable} to ${rel.toTable} is missing pivotTable`);

    // Join pivot → target, carry the source key for grouping
    const pivot = rel.pivotTable;
    const pivotFromCol = rel.pivotFromCol ?? rel.fromCol;
    const pivotToCol   = rel.pivotToCol   ?? rel.toCol;
    let qb: any = db
      .selectFrom(pivot)
      .innerJoin(rel.toTable, `${rel.toTable}.${rel.toCol}`, `${pivot}.${pivotToCol}`)
      .where(`${pivot}.${pivotFromCol}`, "in", keyValues);

    if (args.where)   qb = applyWhere({ qb, where: args.where as Record<string, any> });
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
      ? Object.entries(args.select).filter(([, v]) => v).map(([k]) => `${rel.toTable}.${k}`)
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

  if (args.where)   qb = applyWhere({ qb, where: args.where as Record<string, any> });
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
    ? Object.entries(args.select).filter(([, v]) => v).map(([k]) => k)
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
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
}

function applyCursorWhere({ qb, cursor, orderBy, direction }: { qb: any; cursor: Record<string, any>; orderBy: OrderByClause<any>[]; direction: "after" | "before" }): any {
  const entries = orderBy.flatMap((ob) => Object.entries(ob)) as [string, "asc" | "desc"][];
  if (entries.length === 0) return qb;

  // Correct keyset pagination: (c1 > v1) OR (c1 = v1 AND c2 > v2) OR ...
  // ">" is relative to direction: after+asc or before+desc uses ">", after+desc or before+asc uses "<"
  const branches = entries.map(([pivotCol, _], i) => {
    // equality conditions for all columns before the pivot
    const equalities = entries.slice(0, i).map(([col]) =>
      ({ col, val: cursor[col] })
    );
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
      })
    )
  );
}

// ── Model factory ──────────────────────────────────────────────────────────

function createModel<T>({ db, tableName, tableRelations, tables }: {
  db: Kysely<any>;
  tableName: string;
  tableRelations: RelationDef[];
  tables: TablesDef;
}): SolaModel<T> {
  async function run(args: FindArgs<T> | undefined, limitOverride?: number): Promise<T[]> {
    let qb: any = db.selectFrom(tableName);

    if (args?.where)   qb = applyWhere({ qb, where: args.where as Record<string, any> });
    if (args?.orderBy) {
      for (const ob of args.orderBy) {
        for (const [col, dir] of Object.entries(ob)) {
          if (dir) qb = qb.orderBy(col, dir);
        }
      }
    }

    const limit = limitOverride ?? args?.take;
    if (limit   !== undefined) qb = qb.limit(limit);
    if (args?.skip !== undefined) qb = qb.offset(args.skip);

    const cols = args?.select
      ? Object.entries(args.select).filter(([, v]) => v).map(([k]) => k)
      : [];
    qb = cols.length > 0 ? qb.select(cols) : qb.selectAll();

    const rows: any[] = await qb.execute();
    if (!args?.include || rows.length === 0) return rows as T[];

    for (const [key, includeArgs] of Object.entries(args.include)) {
      if (!includeArgs) continue;
      const rel = tableRelations.find((r) => r.toTable === key);
      if (!rel) continue;

      const nested: NestedArgs = includeArgs === true ? {} : (includeArgs as NestedArgs);
      const { byKey, isArray } = await fetchRelation({ db, tables, rel, mainRows: rows, args: nested });

      for (const row of rows) {
        const fk = row[rel.fromCol];
        const related = byKey.get(fk) ?? [];
        row[key] = isArray ? related : (related[0] ?? null);
      }
    }

    return rows as T[];
  }

  return {
    findMany:  (args) => run(args),
    findFirst: async (args) => (await run(args, 1))[0] ?? null,
    findUnique: async ({ where }) => {
      let qb: any = db.selectFrom(tableName).selectAll();
      qb = applyWhere({ qb, where: where as Record<string, any> });
      const row = await qb.executeTakeFirst();
      if (row == null) throw new Error(`${tableName}: record not found`);
      return row as T;
    },
    exists: async (args) => {
      let qb: any = db.selectFrom(tableName).select((eb: any) => eb.lit(1).as("x")).limit(1);
      if (args?.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
      const row = await qb.executeTakeFirst();
      return row != null;
    },
    count: async (args) => {
      let qb: any = db.selectFrom(tableName).select((eb: any) => eb.fn.countAll().as("n"));
      if (args?.where) qb = applyWhere({ qb, where: args.where as Record<string, any> });
      const row = await qb.executeTakeFirstOrThrow();
      return Number(row.n);
    },
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
            hasNext:     skip + data.length < count,
            hasPrevious: skip > 0,
            startCursor: null,
            endCursor:   null,
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

      const effectiveOrder = direction === "before"
        ? orderBy.map((ob) => Object.fromEntries(
            Object.entries(ob).map(([k, v]) => [k, v === "asc" ? "desc" : "asc"])
          ))
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
          hasNext:     direction === "after"  ? hasMore : after !== undefined,
          hasPrevious: direction === "before" ? hasMore : before !== undefined,
          startCursor: rows.length > 0 ? encodeCursor({ row: rows[0], orderBy }) : null,
          endCursor:   rows.length > 0 ? encodeCursor({ row: rows[rows.length - 1], orderBy }) : null,
        },
      };
    },
  };
}

// ── Public factory ─────────────────────────────────────────────────────────

export function createSola<TDB>({ db, tables, relations }: {
  db: Kysely<any>;
  tables: TablesDef;
  relations: RelationDef[];
}): Sola<TDB> {
  const sola: any = {};
  for (const tableName of Object.keys(tables)) {
    sola[tableName] = createModel({
      db,
      tableName,
      tableRelations: relations.filter((r) => r.fromTable === tableName),
      tables,
    });
  }
  return sola as Sola<TDB>;
}

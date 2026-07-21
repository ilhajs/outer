import type { Column } from "$lib/record-form";
import { store } from "@ilha/store";
import { codec, querySpec, withQuery } from "@ilha/store/query";
import { z } from "zod";

/**
 * Data-grid filter state (`?q=` / `?f=`).
 *
 * - **Write path:** `gridFilters` + `gridFilterQuery.persist` (controls → URL).
 * - **Read path:** `gridFilterQuery.parse(url)` in the loader (URL → first paint + data).
 *
 * @see https://ilha.build/guide/libraries/store/index.md
 */

export type GridFilter = { column: string; op: string; value: string };
type Where = Record<string, unknown>;

/** Operators offered per column type — must stay within the server's filter-operator set. */
export const FILTER_OPS = {
  text: ["contains", "startsWith", "endsWith", "equals"],
  varchar: ["contains", "startsWith", "endsWith", "equals"],
  uuid: ["equals"],
  integer: ["equals", "gt", "gte", "lt", "lte"],
  serial: ["equals", "gt", "gte", "lt", "lte"],
  // exact numerics arrive as strings, but compare as numbers server-side
  bigint: ["equals", "gt", "gte", "lt", "lte"],
  decimal: ["equals", "gt", "gte", "lt", "lte"],
  real: ["equals", "gt", "gte", "lt", "lte"],
  boolean: ["equals"],
  timestamp: ["gt", "gte", "lt", "lte"],
  date: ["gt", "gte", "lt", "lte"],
  jsonb: [],
  // raw bytes have no meaningful text filter
  bytes: [],
} as const satisfies Record<Column["type"], readonly string[]>;

export const ALL_OPS = [...new Set(Object.values(FILTER_OPS).flat())];

const FilterSchema = z.object({ column: z.string(), op: z.string(), value: z.string() });

const filterDefaults = {
  q: "",
  f: [] as GridFilter[],
};

/**
 * Shared codecs / debounce / history for loader parse + client persist.
 * `f` is JSON in one param; `q` is debounced replace; chip edits push immediately.
 */
export const gridFilterQuery = querySpec(filterDefaults, {
  params: {
    q: codec.string(),
    f: codec.json<GridFilter[]>(),
  },
  debounce: { q: 250, f: 0 },
  history: { q: "replace", f: "push" },
});

export const gridFilters = store(
  z.object({
    q: z.string().default(""),
    f: z.array(FilterSchema).default([]),
  }),
)
  .action("add", (filter: GridFilter, { get }) => ({ f: [...get().f, filter] }))
  .action("removeAt", (index: number, { get }) => ({
    f: get().f.filter((_, i) => i !== index),
  }))
  .build();

/** Wires `gridFilters` to `?q=`/`?f=` — call from onMount and return as cleanup. */
export function persistGridFilters(): () => void {
  return gridFilterQuery.persist(gridFilters);
}

// ── List URL helpers (page / size / sort + filters) ─────────────────────────

export const PAGE_SIZES = [25, 50, 100, 200] as const; // API caps `take` at 200
export const DEFAULT_PAGE_SIZE = 50;

export type GridSort = { column: string; dir: "asc" | "desc" };

export function pageFromUrl(url: URL): number {
  return Math.max(1, Number(url.searchParams.get("page")) || 1);
}

export function sizeFromUrl(url: URL): number {
  const size = Number(url.searchParams.get("size"));
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}

export function sortFromUrl(url: URL, columns: Column[]): GridSort | undefined {
  const [column, dir] = (url.searchParams.get("sort") ?? "").split(":");
  if (columns.some((c) => c.name === column) && (dir === "asc" || dir === "desc")) {
    return { column, dir };
  }
  return undefined;
}

/**
 * Builds a grid/list URL without dropping `q`/`f`. Filter keys go through
 * `querySpec.href`; page/size/sort merge via `withQuery`.
 * `path` may be the table root or a detail path (`…/r/:id`, `…/new`) so
 * opening a record keeps the same list query string.
 */
export function gridHref(
  path: string,
  state: {
    page?: number;
    size?: number;
    sort?: GridSort;
    q?: string;
    filters?: GridFilter[];
  } = {},
): string {
  const q = (state.q ?? gridFilters.q()).trim();
  const f = state.filters ?? gridFilters.f();
  const withFilters = gridFilterQuery.href({ q, f }, path);
  return withQuery(withFilters, {
    page: state.page && state.page > 1 ? state.page : null,
    size: state.size && state.size !== DEFAULT_PAGE_SIZE ? state.size : null,
    sort: state.sort ? `${state.sort.column}:${state.sort.dir}` : null,
  });
}

/** Table list path, optionally keeping the current `?…` (close drawer, cancel). */
export function tableListHref(instanceId: string, tableName: string, search = ""): string {
  const base = `/i/${instanceId}/t/${tableName}`;
  if (!search) return base;
  return search.startsWith("?") ? `${base}${search}` : `${base}?${search}`;
}

// ── Loader-side: URL → `where` payload ──────────────────────────────────────

function coerceFilterValue(raw: string, column: Column): unknown {
  switch (column.type) {
    case "integer":
    case "serial": {
      const num = Number(raw);
      return Number.isFinite(num) ? num : undefined;
    }
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : undefined;
    case "timestamp": {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    default:
      return raw;
  }
}

/**
 * Builds the `_admin.data.list` `where` from the URL's filter params.
 * Filters referencing unknown columns, invalid operators, or uncoercible
 * values are silently dropped — stale URLs degrade instead of erroring.
 */
export function whereFromUrl(url: URL, columns: Column[]): Where | undefined {
  const { q, f } = gridFilterQuery.parse(url);
  const conditions: Where[] = [];

  for (const filter of f) {
    const column = columns.find((c) => c.name === filter.column);
    if (!column) continue;
    if (!(FILTER_OPS[column.type] as readonly string[]).includes(filter.op)) continue;
    const value = coerceFilterValue(filter.value, column);
    if (value === undefined) continue;
    conditions.push({ [column.name]: { [filter.op]: value } });
  }

  const search = q.trim();
  if (search) {
    const textColumns = columns.filter(
      (column) => column.type === "text" || column.type === "varchar",
    );
    if (textColumns.length > 0) {
      conditions.push({
        OR: textColumns.map((column) => ({ [column.name]: { contains: search } })),
      });
    }
  }

  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

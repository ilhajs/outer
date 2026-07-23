import {
  DEFAULT_PAGE_SIZE,
  FILTER_OPS,
  PAGE_SIZES,
  gridFilters,
  gridHref,
  pageFromUrl,
  persistGridFilters,
  sizeFromUrl,
  sortFromUrl,
  whereFromUrl,
  gridFilterQuery,
  type GridFilter,
  type GridSort,
} from "$lib/grid-filters";
import { getClient } from "$lib/outer";
import { coercePk, isSecretColumn } from "$lib/record-form";
import { getInstanceById, getTableByName } from "$lib/store";
import {
  defineLayout,
  invalidate,
  loader,
  navigate,
  useRoute,
  type InferLoader,
} from "@ilha/router";
import type { AdminMeta } from "@outerjs/server";
import {
  Badge,
  Button,
  Checkbox,
  ClipboardText,
  Dialog,
  Icon,
  Input,
  Link,
  LinkButton,
  Pagination,
  Resizable,
  Select,
  Table,
  Tooltip,
} from "areia";
import { toast } from "areia/sonner";
import { format, formatDistanceToNow } from "date-fns";
import ilha from "ilha";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide";
import { each, when } from "quando";

type Column = AdminMeta["tables"][number]["columns"][number];
type Row = Record<string, unknown>;

// ── Data loading (shared by index / new / record under this table) ───────────

export const clientLoad = loader(async ({ head, url, params }) => {
  const { instanceId, tableName } = params;
  head({ title: tableName });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  const client = getClient(instance.url);
  const meta = await client._admin.meta();
  const table = getTableByName(meta, tableName);
  if (!table) {
    navigate(`/i/${instanceId}`);
    return {};
  }

  const pk = table.columns.find((column) => column.primaryKey)?.name;
  const size = sizeFromUrl(url);
  const sort =
    sortFromUrl(url, table.columns) ?? (pk ? { column: pk, dir: "asc" as const } : undefined);
  const orderBy = sort
    ? [{ [sort.column]: sort.dir }, ...(pk && sort.column !== pk ? [{ [pk]: "asc" as const }] : [])]
    : undefined;

  const { q, f: filters } = gridFilterQuery.parse(url);
  const where = whereFromUrl(url, table.columns);
  const listArgs = {
    table: tableName,
    take: size,
    ...(where && { where }),
    ...(orderBy && { orderBy }),
  };
  let page = pageFromUrl(url);
  let list = await client._admin.data.list({ ...listArgs, skip: (page - 1) * size });
  if (page > 1 && list.data.length === 0 && list.count > 0) {
    page = Math.max(1, Math.ceil(list.count / size));
    list = await client._admin.data.list({ ...listArgs, skip: (page - 1) * size });
  }

  return { table, list, page, size, sort, instanceId, tableName, q, filters };
});

export type TableLayoutLoader = InferLoader<typeof clientLoad>;

// ── Cell formatting ─────────────────────────────────────────────────────────

function formatCell(value: unknown, type: Column["type"]): string {
  if (type === "timestamp" && (typeof value === "string" || value instanceof Date)) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return format(date, "PPpp");
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

const TRUNCATE_AT = 24;

function truncateMiddle(value: string): string {
  if (value.length <= TRUNCATE_AT) return value;
  return `${value.slice(0, 8).trimEnd()}…${value.slice(-8).trimStart()}`;
}

const URL_PATTERN = /^https?:\/\/\S+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function externalHref(value: string): string | undefined {
  if (URL_PATTERN.test(value)) return value;
  if (EMAIL_PATTERN.test(value)) return `mailto:${value}`;
  return undefined;
}

const isNumeric = (column: Column) => column.type === "integer" || column.type === "serial";
const isIdLike = (column: Column) => column.primaryKey || column.references !== null;

function cellClass(column: Column): string {
  if (isNumeric(column)) return "text-right tabular-nums whitespace-nowrap";
  if (isIdLike(column)) return "font-mono text-sm whitespace-nowrap";
  return "whitespace-nowrap";
}

// ── Cells ───────────────────────────────────────────────────────────────────

function NullCell({ column }: { column: Column }) {
  return (
    <Table.Cell class={cellClass(column)}>
      <span class="text-muted-foreground">—</span>
    </Table.Cell>
  );
}

function BooleanCell(props: { value: unknown; cellKey: string }) {
  return (
    <Table.Cell>
      <Checkbox
        key={props.cellKey}
        checked={props.value === true}
        tabindex="-1"
        aria-readonly="true"
        class="pointer-events-none"
      />
    </Table.Cell>
  );
}

function JsonCell(props: { value: unknown; cellKey: string }) {
  const summary = Array.isArray(props.value)
    ? `[…] ${props.value.length} item${props.value.length === 1 ? "" : "s"}`
    : typeof props.value === "object" && props.value !== null
      ? `{…} ${Object.keys(props.value).length} key${Object.keys(props.value).length === 1 ? "" : "s"}`
      : String(props.value);

  return (
    <Table.Cell class="whitespace-nowrap">
      <Tooltip
        key={props.cellKey}
        triggerAs="span"
        triggerClass="leading-normal whitespace-nowrap font-mono text-sm"
        content={
          <pre class="max-w-md overflow-auto text-xs">{JSON.stringify(props.value, null, 2)}</pre>
        }
      >
        {summary}
      </Tooltip>
    </Table.Cell>
  );
}

function SecretCell(props: { value: unknown; cellKey: string }) {
  return (
    <Table.Cell class="whitespace-nowrap">
      <ClipboardText key={props.cellKey} text="••••••••" textToCopy={String(props.value)} />
    </Table.Cell>
  );
}

function TimestampCell(props: { value: unknown; column: Column; cellKey: string }) {
  const date = new Date(String(props.value));
  if (Number.isNaN(date.getTime())) {
    return <ValueCell value={props.value} column={props.column} cellKey={props.cellKey} />;
  }
  return (
    <Table.Cell class="whitespace-nowrap">
      <Tooltip
        key={props.cellKey}
        triggerAs="span"
        triggerClass="leading-normal whitespace-nowrap"
        content={format(date, "PPpp")}
      >
        {formatDistanceToNow(date, { addSuffix: true })}
      </Tooltip>
    </Table.Cell>
  );
}

function ValueCell(props: { value: unknown; column: Column; href?: string; cellKey: string }) {
  const full = formatCell(props.value, props.column.type);
  const short = truncateMiddle(full);
  const linkHref = props.href ?? externalHref(full);
  const text = linkHref ? (
    <Link href={linkHref} external={!props.href}>
      {short}
    </Link>
  ) : (
    short
  );

  return (
    <Table.Cell class={cellClass(props.column)}>
      {when(
        short !== full,
        () => (
          <Tooltip
            key={props.cellKey}
            triggerAs="span"
            triggerClass="leading-normal whitespace-nowrap"
            content={full}
          >
            {text}
          </Tooltip>
        ),
        () => text,
      )}
    </Table.Cell>
  );
}

function DataCell(props: {
  row: Row;
  column: Column;
  cellKey: string;
  recordHref: (table: string, id: unknown) => string;
  tableName: string;
}) {
  const { row, column, cellKey } = props;
  const value = row[column.name];

  if (value === null || value === undefined) return <NullCell column={column} />;
  if (column.type === "boolean") return <BooleanCell value={value} cellKey={cellKey} />;
  if (column.type === "jsonb") return <JsonCell value={value} cellKey={cellKey} />;
  if (isSecretColumn(column)) {
    return <SecretCell value={value} cellKey={cellKey} />;
  }
  if (column.type === "timestamp") {
    return <TimestampCell value={value} column={column} cellKey={cellKey} />;
  }

  const href = column.primaryKey
    ? props.recordHref(props.tableName, value)
    : column.references
      ? props.recordHref(column.references.table, value)
      : undefined;
  return <ValueCell value={value} column={column} href={href} cellKey={cellKey} />;
}

function DeleteCell(props: { row: Row; pk: Column; cellKey: string }) {
  const id = String(props.row[props.pk.name]);
  return (
    <Table.Cell class="w-0">
      <Dialog
        key={props.cellKey}
        role="alertdialog"
        triggerClass="text-muted-foreground hover:text-areia-danger cursor-pointer"
        contentClass="grid gap-4 p-6"
        content={
          <>
            <Dialog.Title>Delete record</Dialog.Title>
            <Dialog.Description>
              Delete <span class="font-mono">{truncateMiddle(id)}</span>? This cannot be undone.
            </Dialog.Description>
            <div class="flex justify-end gap-2">
              <Dialog.Close>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Dialog.Close>
                <Button variant="destructive" data-delete-record={id}>
                  Delete
                </Button>
              </Dialog.Close>
            </div>
          </>
        }
      >
        <Icon icon={Trash2} class="size-4" />
      </Dialog>
    </Table.Cell>
  );
}

// ── Filter bar (own island so `q` keystrokes don't re-render the Resizable shell) ─

const FilterBar = ilha
  .input<{ columns: Column[]; filters: GridFilter[] }>()
  .state("filterColumn", "")
  .state("filterOp", "")
  .state("filterValue", "")
  .on("#filter-form select[name=column]@change", ({ input, state }) => {
    const column = input.columns?.find((c) => c.name === state.filterColumn());
    const ops: readonly string[] = column ? FILTER_OPS[column.type] : [];
    if (!ops.includes(state.filterOp())) {
      state.filterOp(ops[0] ?? "");
    }
  })
  .on("#filter-form@submit", ({ input, event, state }) => {
    event.preventDefault();
    const column = input.columns?.find((c) => c.name === state.filterColumn());
    if (!column) return void toast.error("Pick a column to filter on");
    const ops = FILTER_OPS[column.type] as readonly string[];
    const op = state.filterOp();
    if (!op || !ops.includes(op)) {
      return void toast.error(
        op ? `"${op}" doesn't apply to ${column.type} columns` : "Pick an operator",
      );
    }
    const value = state.filterValue().trim();
    if (!value) return void toast.error("Enter a filter value");
    gridFilters.add({ column: column.name, op, value });
    state.filterValue("");
  })
  .on("[data-remove-filter]@click", ({ event }) => {
    const index = Number((event.currentTarget as HTMLElement).getAttribute("data-remove-filter"));
    if (Number.isInteger(index)) gridFilters.removeAt(index);
  })
  .render(({ input, state }) => {
    const columns = input.columns ?? [];
    const filters = input.filters ?? [];
    const filterable = columns.filter((column) => FILTER_OPS[column.type].length > 0);
    const selected = columns.find((column) => column.name === state.filterColumn());
    const ops = selected ? FILTER_OPS[selected.type] : [];
    const isTimestamp = selected?.type === "timestamp";

    return (
      <div class="flex flex-wrap items-center gap-2 px-2 pb-2">
        <Input
          type="search"
          name="q"
          placeholder="Search text columns…"
          bind:value={gridFilters.q}
          class="w-56"
        />
        <form id="filter-form" class="flex items-center gap-1">
          <Select
            name="column"
            placeholder="column"
            bind:value={state.filterColumn}
            items={filterable.map((column) => ({
              label: `${column.name} (${column.type})`,
              value: column.name,
            }))}
          />
          <Select
            name="op"
            placeholder="operator"
            bind:value={state.filterOp}
            disabled={ops.length === 0}
            items={ops.map((op) => ({ label: op, value: op }))}
          />
          <Input
            name="value"
            type={isTimestamp ? "datetime-local" : "text"}
            placeholder={isTimestamp ? undefined : "value"}
            bind:value={state.filterValue}
            class="w-36"
          />
          <Button type="submit" variant="outline">
            Add filter
          </Button>
        </form>
        {each(filters).as((filter, index) => (
          <Badge variant="secondary" class="gap-1">
            <span class="font-mono text-xs">
              {filter.column} {filter.op} {truncateMiddle(filter.value)}
            </span>
            <button
              type="button"
              data-remove-filter={index}
              class="cursor-pointer"
              aria-label="Remove filter"
            >
              ✕
            </button>
          </Badge>
        ))}
      </div>
    );
  });

/** Last grid|detail split; survives loader/filter re-renders so morph keeps sizes. */
let tableSplit: [number, number] = [68, 32];

function rememberTableSplit(layout: number[]) {
  if (layout.length >= 2 && layout[0]! > 0 && layout[1]! > 0) {
    tableSplit = [layout[0]!, layout[1]!];
  }
}

function HeadCell(props: {
  column: Column;
  sort?: GridSort;
  sortHref: (sort: GridSort) => string;
}) {
  const { column, sort } = props;
  const active = sort?.column === column.name;
  const nextDir = active && sort.dir === "asc" ? "desc" : "asc";

  return (
    <Table.Head class={isNumeric(column) ? "text-right" : undefined}>
      <Link
        href={props.sortHref({ column: column.name, dir: nextDir })}
        variant="current"
        class="flex items-center gap-1 no-underline"
      >
        {column.name}
        <span class="text-muted-foreground text-xs font-normal">{column.type}</span>
        {when(active, () => (
          <Icon icon={sort!.dir === "asc" ? ArrowUp : ArrowDown} class="size-3" />
        ))}
      </Link>
    </Table.Head>
  );
}

// ── Layout: grid (always) + detail outlet (record / new) ────────────────────

export default defineLayout((Children) =>
  ilha
    .input<TableLayoutLoader>()
    .onMount(({ input }) => {
      gridFilters.setState({
        q: input.q ?? "",
        f: input.filters ?? [],
      });
      return persistGridFilters();
    })
    .on("[data-delete-record]@click", async ({ input, event }) => {
      const { table, instanceId, tableName } = input;
      const pkColumn = table?.columns.find((column) => column.primaryKey);
      const id = (event.currentTarget as HTMLElement).getAttribute("data-delete-record");
      if (!pkColumn || id === null) return;

      try {
        const client = getClient(getInstanceById(instanceId!)!.url);
        await client._admin.data.delete({
          table: tableName!,
          where: { [pkColumn.name]: coercePk(pkColumn, id) },
        });
        toast.success("Record deleted");
        await invalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete record");
      }
    })
    .render(({ input }) => {
      const {
        table,
        list,
        page = 1,
        size = DEFAULT_PAGE_SIZE,
        sort,
        instanceId,
        tableName,
        q = "",
        filters = [],
      } = input;
      const columns = table?.columns ?? [];
      const pkColumn = columns.find((column) => column.primaryKey);
      const count = list?.count ?? 0;
      const tableHref = `/i/${instanceId}/t/${tableName}`;
      const filterState = { q, filters };
      const listState = { page, size, sort, ...filterState };

      const { path, params } = useRoute();
      const selectedId = params().recordId as string | undefined;
      const detailOpen = Boolean(selectedId) || path().endsWith("/new");

      const recordHref = (targetTable: string, id: unknown) => {
        const base = `/i/${instanceId}/t/${targetTable}/r/${encodeURIComponent(String(id))}`;
        // Keep list query on same-table opens so the grid loader stays filtered.
        return targetTable === tableName ? gridHref(base, listState) : base;
      };
      const sortHref = (next: GridSort) =>
        gridHref(tableHref, { size, sort: next, ...filterState });
      const pageHref = (target: number) =>
        gridHref(tableHref, { page: target, size, sort, ...filterState });
      const newHref = gridHref(`${tableHref}/new`, listState);

      const grid = (
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <header class="flex items-center justify-between gap-2 p-2">
            <h2 class="flex items-baseline gap-2 text-2xl font-semibold">
              {tableName}
              <span class="text-muted-foreground text-sm font-normal tabular-nums">
                {count} record{count === 1 ? "" : "s"}
              </span>
            </h2>
            <LinkButton variant="secondary" href={newHref} icon={<Icon icon={Plus} />}>
              Add Record
            </LinkButton>
          </header>

          <FilterBar key="table-filters" columns={columns} filters={filters} />

          <div class="min-h-0 flex-1 overflow-auto">
            <Table>
              <Table.Header class="sticky top-0 z-10">
                <Table.Row>
                  {each(columns).as((column) => (
                    <HeadCell column={column} sort={sort} sortHref={sortHref} />
                  ))}
                  {when(pkColumn, () => (
                    <Table.Head class="w-0" />
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {each(list?.data ?? [])
                  .as((row, rowIndex) => {
                    const rowId = pkColumn ? String(row[pkColumn.name]) : undefined;
                    const selected = Boolean(selectedId && rowId === selectedId);
                    return (
                      <Table.Row
                        class={selected ? "bg-areia-control-background/80" : undefined}
                        data-selected={selected ? "true" : undefined}
                      >
                        {each(columns).as((column) => (
                          <DataCell
                            row={row}
                            column={column}
                            cellKey={`cell-${rowIndex}-${column.name}`}
                            recordHref={recordHref}
                            tableName={tableName!}
                          />
                        ))}
                        {when(pkColumn, (pk) => (
                          <DeleteCell row={row} pk={pk} cellKey={`delete-${rowIndex}`} />
                        ))}
                      </Table.Row>
                    );
                  })
                  .else(
                    <Table.Row>
                      <Table.Cell colspan={Math.max(1, columns.length + 1)}>
                        <span class="text-muted-foreground">No records yet.</span>
                      </Table.Cell>
                    </Table.Row>,
                  )}
              </Table.Body>
            </Table>
          </div>

          <footer class="border-areia-border border-t p-3">
            <Pagination
              key="grid-pagination"
              page={page}
              perPage={size}
              totalCount={count}
              setPage={(target: number) => navigate(pageHref(target))}
              onPageSizeChange={(next: number) =>
                navigate(gridHref(tableHref, { size: next, sort, ...filterState }))
              }
            >
              <Pagination.Info page={page} perPage={size} totalCount={count} />
              <div class="grow"></div>
              <Pagination.PageSize value={size} options={[...PAGE_SIZES]} />
              <Pagination.Separator />
              <Pagination.Controls page={page} perPage={size} totalCount={count} />
            </Pagination>
          </footer>
        </div>
      );

      // Nested under dashboard Resizable → sidebar | grid | detail.
      // Remembered % sizes + data-morph-preserve=style so loader/filter re-renders
      // don't clobber the controller's flex-grow (morph would write template defaults).
      if (detailOpen) {
        return (
          <Resizable.Root
            key="table-split"
            direction="horizontal"
            class="flex-1"
            onLayoutChange={rememberTableSplit}
          >
            <Resizable.Panel
              defaultSize={tableSplit[0]}
              minSize={35}
              data-morph-preserve="style"
              class="flex min-w-0 flex-col overflow-hidden"
            >
              {grid}
            </Resizable.Panel>
            <Resizable.Handle />
            <Resizable.Panel
              defaultSize={tableSplit[1]}
              minSize={18}
              maxSize={55}
              data-morph-preserve="style"
              class="flex min-w-0 flex-col overflow-hidden"
            >
              <Children />
            </Resizable.Panel>
          </Resizable.Root>
        );
      }

      return <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{grid}</div>;
    }),
);

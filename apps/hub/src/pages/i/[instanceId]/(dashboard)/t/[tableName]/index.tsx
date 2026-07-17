import { getClient } from "$lib/outer";
import { coercePk } from "$lib/record-form";
import { getInstanceById, getTableByName } from "$lib/store";
import { invalidate, loader, navigate, type InferLoader } from "@ilha/router";
import type { AdminMeta } from "@outerjs/server";
import {
  Button,
  Checkbox,
  ClipboardText,
  Dialog,
  Icon,
  Link,
  LinkButton,
  Pagination,
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
type Sort = { column: string; dir: "asc" | "desc" };

const PAGE_SIZES = [25, 50, 100, 200]; // API caps `take` at 200
const DEFAULT_PAGE_SIZE = 50;

// ── URL state ───────────────────────────────────────────────────────────────

function pageFromUrl(url: URL): number {
  return Math.max(1, Number(url.searchParams.get("page")) || 1);
}

function sizeFromUrl(url: URL): number {
  const size = Number(url.searchParams.get("size"));
  return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
}

function sortFromUrl(url: URL, columns: Column[]): Sort | undefined {
  const [column, dir] = (url.searchParams.get("sort") ?? "").split(":");
  if (columns.some((c) => c.name === column) && (dir === "asc" || dir === "desc")) {
    return { column, dir };
  }
  return undefined;
}

/** Builds a grid URL, omitting defaults so common links stay clean. */
function gridHref(tableHref: string, state: { page?: number; size?: number; sort?: Sort }): string {
  const query = new URLSearchParams();
  if (state.page && state.page > 1) query.set("page", String(state.page));
  if (state.size && state.size !== DEFAULT_PAGE_SIZE) query.set("size", String(state.size));
  if (state.sort) query.set("sort", `${state.sort.column}:${state.sort.dir}`);
  const suffix = query.toString();
  return suffix ? `${tableHref}?${suffix}` : tableHref;
}

// ── Data loading ────────────────────────────────────────────────────────────

export const clientLoad = loader(async ({ head, url, params }) => {
  // loaders must read the pending route's params from their own context —
  // useRoute() still holds the previous route while a navigation is in flight
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
  const page = pageFromUrl(url);
  const size = sizeFromUrl(url);
  const sort =
    sortFromUrl(url, table.columns) ?? (pk ? { column: pk, dir: "asc" as const } : undefined);
  // PK tiebreaker keeps pagination stable when the sorted column has duplicates
  const orderBy = sort
    ? [{ [sort.column]: sort.dir }, ...(pk && sort.column !== pk ? [{ [pk]: "asc" as const }] : [])]
    : undefined;

  const list = await client._admin.data.list({
    table: tableName,
    take: size,
    skip: (page - 1) * size,
    ...(orderBy && { orderBy }),
  });

  return { table, list, page, size, sort, instanceId, tableName };
});

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

/** Middle truncation ("asd1…fois") so both the prefix and the distinctive tail of ids stay visible. */
function truncateMiddle(value: string): string {
  if (value.length <= TRUNCATE_AT) return value;
  return `${value.slice(0, 8).trimEnd()}…${value.slice(-8).trimStart()}`;
}

const URL_PATTERN = /^https?:\/\/\S+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Href for cell values that are themselves a link or an email address. */
function externalHref(value: string): string | undefined {
  if (URL_PATTERN.test(value)) return value;
  if (EMAIL_PATTERN.test(value)) return `mailto:${value}`;
  return undefined;
}

/** Columns whose values shouldn't be readable at a glance. */
const SECRET_PATTERN = /token|password|secret/i;

const isNumeric = (column: Column) => column.type === "integer" || column.type === "serial";
const isIdLike = (column: Column) => column.primaryKey || column.references !== null;

/** Per-column presentation: numbers right-aligned, ids/references in monospace. */
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

/** Booleans render as a display-only checkbox — pointer events off so it reads as state, not a control. */
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

/** jsonb summary badge — the pretty-printed document lives in the tooltip. */
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

/** Secret-looking values render masked; the copy button still grabs the real value. */
function SecretCell(props: { value: unknown; cellKey: string }) {
  return (
    <Table.Cell class="whitespace-nowrap">
      <ClipboardText key={props.cellKey} text="••••••••" textToCopy={String(props.value)} />
    </Table.Cell>
  );
}

/** Timestamps read as relative time; the exact date is in the tooltip. */
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

/**
 * Default cell: formatted, middle-truncated, wrapped in a Tooltip with the
 * full value when truncated. Linked when it's the PK (own record), a foreign
 * key (referenced record), or a URL/email value.
 */
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
            // areia's trigger defaults to leading-0, which collapses an inline-flex
            // span to 0px height — the popup then positions on top of the text
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

// ── Rows ────────────────────────────────────────────────────────────────────

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
  if (column.type === "text" && SECRET_PATTERN.test(column.name)) {
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
              {/* Dialog.Close closes on click; the click still bubbles to the island's
                  [data-delete-record] handler, which performs the actual delete */}
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

// ── Header ──────────────────────────────────────────────────────────────────

/** Column header — clicking sorts by the column, toggling direction when already active. */
function HeadCell(props: { column: Column; sort?: Sort; sortHref: (sort: Sort) => string }) {
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

// ── Page ────────────────────────────────────────────────────────────────────

export default ilha
  .input<InferLoader<typeof clientLoad>>()
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
    const { table, list, page = 1, size = DEFAULT_PAGE_SIZE, sort, instanceId, tableName } = input;
    const columns = table?.columns ?? [];
    const pkColumn = columns.find((column) => column.primaryKey);
    const count = list?.count ?? 0;
    const tableHref = `/i/${instanceId}/t/${tableName}`;
    const recordHref = (targetTable: string, id: unknown) =>
      `/i/${instanceId}/t/${targetTable}/r/${encodeURIComponent(String(id))}`;
    // sorting resets to page 1; page changes keep sort and size
    const sortHref = (next: Sort) => gridHref(tableHref, { size, sort: next });
    const pageHref = (target: number) => gridHref(tableHref, { page: target, size, sort });

    return (
      <div class="flex flex-1 flex-col overflow-hidden">
        <header class="flex items-center justify-between gap-2 p-2">
          <h2 class="flex items-baseline gap-2 text-lg font-semibold">
            {tableName}
            <span class="text-muted-foreground text-sm font-normal tabular-nums">
              {count} record{count === 1 ? "" : "s"}
            </span>
          </h2>
          <LinkButton href={`${tableHref}/new`} icon={<Icon icon={Plus} />}>
            Add Record
          </LinkButton>
        </header>

        <div class="flex-1 overflow-auto">
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
                .as((row, rowIndex) => (
                  <Table.Row>
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
                ))
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

        <footer class="border-areia-border border-t p-2">
          <Pagination
            page={page}
            perPage={size}
            totalCount={count}
            setPage={(target: number) => navigate(pageHref(target))}
            onPageSizeChange={(next: number) => navigate(gridHref(tableHref, { size: next, sort }))}
          >
            <Pagination.Info page={page} perPage={size} totalCount={count} />
            <div class="grow"></div>
            <Pagination.PageSize value={size} options={PAGE_SIZES} />
            <Pagination.Separator />
            <Pagination.Controls page={page} perPage={size} totalCount={count} />
          </Pagination>
        </footer>
      </div>
    );
  });

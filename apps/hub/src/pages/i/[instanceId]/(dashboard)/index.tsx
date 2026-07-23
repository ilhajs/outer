/**
 * Instance dashboard — the landing view for an instance. Summarizes the schema
 * (tables, total records, dialect, version) and migration state, all read
 * through the admin API (`_admin.meta`, `_admin.data.list` counts,
 * `_admin.migrations`).
 */
import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { loader, navigate, type MergeLoaders } from "@ilha/router";
import type { AdminMeta, AdminMigrationStatus } from "@outerjs/server";
import { Badge, Icon, Link, LinkButton, Table } from "areia";
import { format, formatDistanceToNow } from "date-fns";
import ilha from "ilha";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Database,
  FolderOpen,
  type IconNode,
  Layers,
  Table2,
} from "lucide";
import { each, when } from "quando";

import type { clientLoad as layoutLoad } from "./+layout";

type TableCount = { name: string; columns: number; records: number };

// ── Loader ────────────────────────────────────────────────────────────────────

export const clientLoad = loader(async ({ head, params }) => {
  const { instanceId } = params;
  head({ title: "Dashboard" });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  const client = getClient(instance.url);
  const meta = (await client._admin.meta()) as AdminMeta;

  // One count query per table — `take: 1` keeps the payload tiny; we only read `count`.
  const counts = await Promise.all(
    meta.tables.map(async (table): Promise<TableCount> => {
      try {
        const { count } = await client._admin.data.list({ table: table.name, take: 1 });
        return { name: table.name, columns: table.columns.length, records: count };
      } catch {
        return { name: table.name, columns: table.columns.length, records: -1 };
      }
    }),
  );

  const migrations = (await client._admin.migrations()) as AdminMigrationStatus[];

  return { instanceId, counts, migrations };
});

export type DashboardLoader = MergeLoaders<[typeof layoutLoad, typeof clientLoad]>;

// ── Presentation helpers ──────────────────────────────────────────────────────

function formatNumber(value: number): string {
  return value < 0 ? "—" : new Intl.NumberFormat().format(value);
}

function Stat(props: { icon: IconNode; label: string; value: string; hint?: string }) {
  return (
    <div class="border-areia-border flex flex-col gap-1 rounded-lg border p-4">
      <div class="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon icon={props.icon} class="size-4" />
        {props.label}
      </div>
      <div class="text-2xl font-semibold tabular-nums">{props.value}</div>
      {when(Boolean(props.hint), () => (
        <div class="text-muted-foreground text-xs">{props.hint}</div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default ilha.input<DashboardLoader>().render(({ input }) => {
  const { instance, meta, instanceId, counts = [], migrations = [] } = input;

  if (!meta) {
    return <div class="text-muted-foreground p-4 text-sm">Loading…</div>;
  }

  const totalRecords = counts.reduce((sum, table) => sum + Math.max(0, table.records), 0);
  const hasFiles = meta.tables.some((table) => table.name === "file");
  const applied = migrations.filter((migration) => migration.executedAt !== null);
  const pending = migrations.filter((migration) => migration.executedAt === null);

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4">
      <header class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold">{instance?.name ?? meta.name}</h1>
          <p class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span>{meta.name}</span>
            <span aria-hidden>·</span>
            <Badge variant="secondary" class="font-mono">
              {meta.dialect}
            </Badge>
            {when(Boolean(meta.version), () => (
              <Badge variant="secondary" class="font-mono">
                schema {meta.version}
              </Badge>
            ))}
          </p>
        </div>
        <div class="flex items-center gap-2">
          {when(hasFiles, () => (
            <LinkButton
              variant="secondary"
              href={`/i/${instanceId}/files`}
              icon={<Icon icon={FolderOpen} />}
            >
              Files
            </LinkButton>
          ))}
          {when(meta.openapi, () => (
            <LinkButton
              variant="secondary"
              href={`/i/${instanceId}/scalar`}
              icon={<Icon icon={BookOpen} />}
            >
              API Reference
            </LinkButton>
          ))}
        </div>
      </header>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
        <Stat icon={Table2} label="Tables" value={formatNumber(meta.tables.length)} />
        <Stat
          icon={Database}
          label="Total records"
          value={formatNumber(totalRecords)}
          hint="across all tables"
        />
        <Stat
          icon={Layers}
          label="Schema versions"
          value={formatNumber(meta.versions.length)}
          hint={meta.version ? `latest ${meta.version}` : "no schema registered"}
        />
        <Stat
          icon={pending.length > 0 ? Clock : CheckCircle2}
          label="Migrations"
          value={`${applied.length}/${migrations.length}`}
          hint={pending.length > 0 ? `${pending.length} pending` : "all applied"}
        />
      </div>

      {/* Tables */}
      <section class="flex flex-col gap-2">
        <h2 class="text-areia-surface-muted-foreground text-sm font-semibold">Tables</h2>
        <div class="border-areia-border overflow-hidden rounded-lg border">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Name</Table.Head>
                <Table.Head class="text-right">Columns</Table.Head>
                <Table.Head class="text-right">Records</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {each(counts)
                .as((table) => (
                  <Table.Row>
                    <Table.Cell>
                      <LinkButton
                        variant="ghost"
                        size="sm"
                        href={`/i/${instanceId}/t/${table.name}`}
                      >
                        {table.name}
                      </LinkButton>
                    </Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {formatNumber(table.columns)}
                    </Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {formatNumber(table.records)}
                    </Table.Cell>
                  </Table.Row>
                ))
                .else(
                  <Table.Row>
                    <Table.Cell colspan={3}>
                      <span class="text-muted-foreground">No tables registered.</span>
                    </Table.Cell>
                  </Table.Row>,
                )}
            </Table.Body>
          </Table>
        </div>
      </section>

      {/* Migrations */}
      <section class="flex flex-col gap-2">
        <h2 class="text-areia-surface-muted-foreground text-sm font-semibold">Migrations</h2>
        <div class="border-areia-border overflow-hidden rounded-lg border">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Name</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head class="text-right">Applied</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {each(migrations)
                .as((migration) => {
                  const executedAt = migration.executedAt ? new Date(migration.executedAt) : null;
                  return (
                    <Table.Row>
                      <Table.Cell class="font-mono text-sm">{migration.name}</Table.Cell>
                      <Table.Cell>
                        {when(
                          executedAt !== null,
                          () => (
                            <Badge variant="success">applied</Badge>
                          ),
                          () => (
                            <Badge variant="warning">pending</Badge>
                          ),
                        )}
                      </Table.Cell>
                      <Table.Cell class="text-muted-foreground text-right text-sm whitespace-nowrap">
                        {when(
                          executedAt !== null,
                          () => (
                            <>
                              {formatDistanceToNow(executedAt!, { addSuffix: true })}
                              <span class="text-muted-foreground ml-2 hidden text-xs sm:inline">
                                {format(executedAt!, "PP")}
                              </span>
                            </>
                          ),
                          () => "—",
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })
                .else(
                  <Table.Row>
                    <Table.Cell colspan={3}>
                      <span class="text-muted-foreground">No migrations recorded.</span>
                    </Table.Cell>
                  </Table.Row>,
                )}
            </Table.Body>
          </Table>
        </div>
      </section>

      <footer class="text-muted-foreground mt-auto flex items-center justify-end gap-3 text-xs">
        <Link href="https://outer.now/getting-started/" external>
          Docs
        </Link>
        <span aria-hidden>·</span>
        <Link href="https://github.com/ilhajs/outer" external>
          GitHub
        </Link>
      </footer>
    </div>
  );
});

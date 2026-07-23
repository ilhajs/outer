import { tableListHref } from "$lib/grid-filters";
import { tryFetchMeta } from "$lib/meta";
import { getClient } from "$lib/outer";
import { buildNewRecord, RecordField } from "$lib/record-form";
import { getInstanceById, getTableByName } from "$lib/store";
import { loader, navigate, useRoute, type InferLoader } from "@ilha/router";
import { Button, Icon, LinkButton } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { X } from "lucide";
import { each, when } from "quando";

export const clientLoad = loader(async ({ head, params }) => {
  const { instanceId, tableName } = params;
  head({ title: `New ${tableName}` });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  const meta = await tryFetchMeta(instance);
  // Unreachable — the dashboard layout renders the connection-error screen.
  if (!meta) return { instanceId, tableName };

  const table = getTableByName(meta, tableName);
  if (!table) {
    navigate(`/i/${instanceId}`);
    return {};
  }

  return { table, instanceId, tableName };
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("saving", false)
  .on("#record-form@submit", async ({ input, state, event }) => {
    event.preventDefault();
    const { table, instanceId, tableName } = input;
    if (!table) return;

    const result = buildNewRecord(new FormData(event.target as HTMLFormElement), table.columns);
    if (!result.ok) return void toast.error(result.error);

    state.saving(true);
    try {
      const client = getClient(getInstanceById(instanceId!)!.url);
      const created = await client._admin.data.create({ table: tableName!, data: result.data });
      toast.success("Record created");
      const pk = table.columns.find((column) => column.primaryKey);
      const pkValue = pk ? created[pk.name] : undefined;
      const search = useRoute().search();
      if (pkValue !== undefined && pkValue !== null) {
        const recordPath = `/i/${instanceId}/t/${tableName}/r/${encodeURIComponent(String(pkValue))}`;
        navigate(
          search ? `${recordPath}${search.startsWith("?") ? search : `?${search}`}` : recordPath,
        );
      } else {
        navigate(tableListHref(instanceId!, tableName!, search));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create record");
    } finally {
      state.saving(false);
    }
  })
  .render(({ input, state }) => {
    const { table, instanceId, tableName } = input;
    const columns = (table?.columns ?? []).filter((column) => column.type !== "serial");
    const search = useRoute().search();
    const closeHref = tableListHref(instanceId!, tableName!, search);

    return (
      <div class="flex h-full min-h-0 flex-col">
        <header class="border-areia-border flex items-center justify-between gap-2 border-b p-3">
          <h3 class="min-w-0 truncate text-base font-semibold">New {tableName}</h3>
          <LinkButton
            href={closeHref}
            variant="ghost"
            shape="square"
            size="sm"
            aria-label="Close"
            title="Close"
          >
            <Icon icon={X} class="size-4" />
          </LinkButton>
        </header>

        <form id="record-form" class="flex min-h-0 flex-1 flex-col">
          <div class="flex flex-1 flex-col gap-3 overflow-auto p-3">
            {each(columns).as((column) => (
              <RecordField column={column} />
            ))}
          </div>
          <div class="border-areia-border flex items-center justify-end gap-2 border-t p-3">
            <LinkButton href={closeHref} variant="ghost">
              Cancel
            </LinkButton>
            <Button type="submit" variant="primary" disabled={state.saving()}>
              {when(
                state.saving(),
                () => "Creating…",
                () => "Create Record",
              )}
            </Button>
          </div>
        </form>
      </div>
    );
  });

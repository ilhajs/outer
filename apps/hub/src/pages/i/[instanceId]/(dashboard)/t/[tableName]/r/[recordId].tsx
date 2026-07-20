import { tableListHref } from "$lib/grid-filters";
import { getClient } from "$lib/outer";
import { buildChanges, coercePk, RecordField } from "$lib/record-form";
import { getInstanceById, getTableByName } from "$lib/store";
import { invalidate, loader, navigate, useRoute, type InferLoader } from "@ilha/router";
import { Button, Icon, LinkButton } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { X } from "lucide";
import { each, when } from "quando";

export const clientLoad = loader(async ({ head, params, url }) => {
  const { instanceId, tableName, recordId } = params;
  head({ title: `${tableName} · ${recordId}` });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  const client = getClient(instance.url);
  const meta = await client._admin.meta();
  const table = getTableByName(meta, tableName);
  const pkColumn = table?.columns.find((column) => column.primaryKey);
  if (!table || !pkColumn) {
    navigate(`/i/${instanceId}`);
    return {};
  }

  const record = await client._admin.data.get({
    table: tableName,
    where: { [pkColumn.name]: coercePk(pkColumn, recordId) },
  });
  if (!record) {
    toast.error(`Record "${recordId}" not found in ${tableName}`);
    navigate(tableListHref(instanceId, tableName, url.search));
    return {};
  }

  return { table, record, instanceId, tableName, recordId };
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("saving", false)
  .on("#record-form@submit", async ({ input, state, event }) => {
    event.preventDefault();
    const { table, record, instanceId, tableName, recordId } = input;
    if (!table || !record) return;

    const pkColumn = table.columns.find((column) => column.primaryKey)!;
    const changes = buildChanges(
      new FormData(event.target as HTMLFormElement),
      table.columns,
      record,
    );
    if (!changes.ok) return void toast.error(changes.error);
    if (Object.keys(changes.data).length === 0) return void toast.info("No changes to save");

    state.saving(true);
    try {
      const client = getClient(getInstanceById(instanceId!)!.url);
      await client._admin.data.update({
        table: tableName!,
        where: { [pkColumn.name]: coercePk(pkColumn, recordId!) },
        data: changes.data,
      });
      toast.success("Record saved");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save record");
    } finally {
      state.saving(false);
    }
  })
  .render(({ input, state }) => {
    const { table, record, instanceId, tableName } = input;
    const columns = table?.columns ?? [];
    const closeHref = tableListHref(instanceId!, tableName!, useRoute().search());

    return (
      <div class="flex h-full min-h-0 flex-col">
        <header class="border-areia-border flex items-center justify-between gap-2 border-b p-3">
          <h3 class="min-w-0 truncate text-base font-semibold">Edit {tableName}</h3>
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
              <RecordField
                column={column}
                value={record?.[column.name]}
                disabled={column.primaryKey}
              />
            ))}
          </div>
          <div class="border-areia-border flex items-center justify-end gap-2 border-t p-3">
            <LinkButton href={closeHref} variant="ghost">
              Cancel
            </LinkButton>
            <Button type="submit" variant="primary" disabled={state.saving()}>
              {when(
                state.saving(),
                () => "Saving…",
                () => "Save Changes",
              )}
            </Button>
          </div>
        </form>
      </div>
    );
  });

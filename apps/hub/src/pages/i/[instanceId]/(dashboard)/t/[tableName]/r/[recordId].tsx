import { getClient } from "$lib/outer";
import { buildChanges, coercePk, RecordField } from "$lib/record-form";
import { getInstanceById, getTableByName } from "$lib/store";
import { invalidate, loader, navigate, type InferLoader } from "@ilha/router";
import { Button, LayerCard, LinkButton } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { each, when } from "quando";

export const clientLoad = loader(async ({ head, params }) => {
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
    navigate(`/i/${instanceId}/t/${tableName}`);
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
    const { table, record, instanceId, tableName, recordId } = input;
    const columns = table?.columns ?? [];

    return (
      <div class="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <LayerCard class="w-full max-w-2xl self-center">
          <LayerCard.Title>
            Edit {tableName} · <span class="text-muted-foreground">{recordId}</span>
          </LayerCard.Title>
          <LayerCard.Content>
            <form id="record-form" class="flex flex-col gap-3">
              {each(columns).as((column) => (
                <RecordField
                  column={column}
                  value={record?.[column.name]}
                  disabled={column.primaryKey}
                />
              ))}
              <div class="mt-2 flex items-center justify-end gap-2">
                <LinkButton href={`/i/${instanceId}/t/${tableName}`} variant="ghost">
                  Back
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
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });

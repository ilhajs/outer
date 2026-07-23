import { pingInstance } from "$lib/outer";
import { appStore } from "$lib/store";
import { loader } from "@ilha/router";
import { Button, Dialog, Icon, LayerCard, LinkButton, Tooltip } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { Plus, Trash2 } from "lucide";
import { each, when } from "quando";

export const clientLoad = loader(({ head }) => {
  head({ title: "Pick Instance" });
});

type Health = Record<string, "up" | "down">;

export default ilha
  .state("health", {} as Health)
  .onMount(({ state }) => {
    // Probe every saved instance concurrently; dots fill in as answers arrive.
    for (const instance of appStore.getState().instances) {
      void pingInstance(instance.url).then((reachable) => {
        state.health({ ...state.health(), [instance.id]: reachable ? "up" : "down" });
      });
    }
  })
  .on("[data-delete-instance]@click", ({ event }) => {
    const id = (event.currentTarget as HTMLElement).getAttribute("data-delete-instance");
    if (!id) return;
    appStore.removeInstance(id);
    toast.success("Instance removed");
  })
  .render(({ state }) => (
    <div class="flex min-h-screen flex-col items-center justify-center gap-4">
      <LayerCard class="w-full max-w-lg">
        <LayerCard.Title class="flex items-center justify-between">
          <span>Outer Instances</span>
          <LinkButton href="/i/new" size="sm" icon={<Icon icon={Plus} />}>
            Add Instance
          </LinkButton>
        </LayerCard.Title>
        <LayerCard.Content class="flex flex-col">
          {each(appStore.instances())
            .as((instance) => (
              <div class="group flex items-center gap-1">
                <LinkButton href={`/i/${instance.id}`} class="min-w-0 flex-1">
                  <Tooltip
                    key={`health-${instance.id}`}
                    triggerAs="span"
                    triggerClass="leading-normal inline-flex shrink-0"
                    content={when(
                      state.health()[instance.id] === undefined,
                      () => "Checking…",
                      () => (state.health()[instance.id] === "up" ? "Reachable" : "Unreachable"),
                    )}
                  >
                    <span
                      class={`size-2 rounded-full ${
                        state.health()[instance.id] === undefined
                          ? "bg-areia-border animate-pulse"
                          : state.health()[instance.id] === "up"
                            ? "bg-areia-success"
                            : "bg-areia-danger"
                      }`}
                    />
                  </Tooltip>
                  <span class="truncate">{instance.name}</span>
                  <span class="text-muted-foreground truncate text-xs font-normal">
                    {instance.url}
                  </span>
                </LinkButton>
                <Dialog
                  key={`delete-instance-${instance.id}`}
                  role="alertdialog"
                  contentClass="grid gap-4 p-6"
                  content={
                    <>
                      <Dialog.Title>Remove instance</Dialog.Title>
                      <Dialog.Description>
                        Remove <span class="font-medium">{instance.name}</span> from this list? This
                        only forgets the saved connection — the instance itself and its data are
                        untouched.
                      </Dialog.Description>
                      <div class="flex justify-end gap-2">
                        <Dialog.Close>
                          <Button variant="secondary">Cancel</Button>
                        </Dialog.Close>
                        <Dialog.Close>
                          <Button variant="destructive" data-delete-instance={instance.id}>
                            Remove
                          </Button>
                        </Dialog.Close>
                      </div>
                    </>
                  }
                >
                  <span
                    class="text-muted-foreground hover:text-areia-danger hover:bg-areia-control-hover inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md"
                    aria-label={`Remove ${instance.name}`}
                    title="Remove instance"
                  >
                    <Icon icon={Trash2} class="size-4" />
                  </span>
                </Dialog>
              </div>
            ))
            .else(<p>No instances saved.</p>)}
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));

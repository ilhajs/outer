import { pingInstance } from "$lib/outer";
import { appStore } from "$lib/store";
import { loader, navigate, type InferLoader } from "@ilha/router";
import { Button, Icon, Input, LayerCard, LinkButton } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { ChevronLeft, Plus } from "lucide";
import { when } from "quando";

export const clientLoad = loader(({ head }) => {
  head({ title: "New Instance" });
  return {};
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("testing", false)
  .on("#add-instance-form@submit", async ({ state, event }) => {
    event.preventDefault();
    if (state.testing()) return;
    const form = event.target as HTMLFormElement;
    const url = String(new FormData(form).get("url") ?? "");

    // Probe before saving — a typo'd URL would otherwise become a dead entry
    // the user only discovers on the dashboard's connection-error screen.
    state.testing(true);
    try {
      const reachable = await pingInstance(url);
      if (!reachable) {
        return void toast.error(
          "Couldn't reach an Outer instance at that URL. Check the address and that the server has .admin() enabled.",
        );
      }
    } finally {
      state.testing(false);
    }

    appStore.addInstance(event);
    return navigate("/i");
  })
  .render(({ state }) => (
    <div class="flex min-h-screen flex-col items-center justify-center gap-4">
      <LayerCard class="max-w-lg">
        <LayerCard.Title>
          <div class="flex items-center gap-2">
            <LinkButton href="/i" size="sm" shape="square" icon={<Icon icon={ChevronLeft} />} />
            <span>Add Instance</span>
          </div>
        </LayerCard.Title>
        <LayerCard.Content>
          <form id="add-instance-form" class="flex flex-col gap-2">
            <Input name="name" label="Instance Name" />
            <Input type="url" name="url" label="Instance URL" placeholder="https://" />
            <Button
              type="submit"
              variant="primary"
              class="w-full"
              disabled={state.testing()}
              icon={<Icon icon={Plus} />}
            >
              {when(
                state.testing(),
                () => "Testing connection…",
                () => "Add Instance",
              )}
            </Button>
          </form>
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));

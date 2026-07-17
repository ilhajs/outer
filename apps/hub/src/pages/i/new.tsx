import { appStore } from "$lib/store";
import { loader, navigate, type InferLoader } from "@ilha/router";
import { preventDefault } from "@ilha/store/form";
import { Button, Icon, Input, LayerCard, LinkButton } from "areia";
import ilha from "ilha";
import { ChevronLeft, Plus } from "lucide";

export const clientLoad = loader(({ head }) => {
  head({ title: "New Instance" });
  return {};
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .on(
    "#add-instance-form@submit",
    preventDefault(({ event }) => {
      appStore.addInstance(event);
      return navigate("/i");
    }),
  )
  .render(() => (
    <div class="flex min-h-screen flex-col items-center justify-center gap-4">
      <LayerCard class="max-w-lg">
        <LayerCard.Title>
          <div class="flex items-center gap-2">
            <LinkButton href="/" size="sm" shape="square" icon={<Icon icon={ChevronLeft} />} />
            <span>Add Instance</span>
          </div>
        </LayerCard.Title>
        <LayerCard.Content>
          <form id="add-instance-form" class="flex flex-col gap-2">
            <Input name="name" label="Instance Name" />
            <Input type="url" name="url" label="Instance URL" placeholder="https://" />
            <Button type="submit" variant="primary" class="w-full" icon={<Icon icon={Plus} />}>
              Add Instance
            </Button>
          </form>
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));

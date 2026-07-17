import { appStore } from "$lib/store";
import { loader } from "@ilha/router";
import { Icon, LayerCard, LinkButton } from "areia";
import ilha from "ilha";
import { Plus } from "lucide";
import { each } from "quando";

export const clientLoad = loader(({ head }) => {
  head({ title: "Pick Instance" });
});

export default ilha.render(() => (
  <div class="flex min-h-screen flex-col items-center justify-center gap-4">
    <LayerCard class="max-w-lg">
      <LayerCard.Title class="flex items-center justify-between">
        <span>Outer Instances</span>
        <LinkButton href="/i/new" size="sm" icon={<Icon icon={Plus} />}>
          Add Instance
        </LinkButton>
      </LayerCard.Title>
      <LayerCard.Content class="flex flex-col">
        {each(appStore.instances())
          .as((instance) => (
            <LinkButton href={`/i/${instance.id}`} class="w-full">
              {instance.name}
            </LinkButton>
          ))
          .else(<p>No instances saved.</p>)}
      </LayerCard.Content>
    </LayerCard>
  </div>
));

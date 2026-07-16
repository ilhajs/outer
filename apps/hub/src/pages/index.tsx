import { client } from "$lib/outer";
import { loader, type InferLoader } from "@ilha/router";
import { LayerCard } from "areia";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "Instances" });
  return {};
});

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .onMount(() => {
    client._admin.meta().then((meta) => console.log(meta));
  })
  .render(() => (
    <div class="flex flex-col gap-4">
      <LayerCard>
        <LayerCard.Title>Instances</LayerCard.Title>
        <LayerCard.Content>Pick instance.</LayerCard.Content>
      </LayerCard>
    </div>
  ));

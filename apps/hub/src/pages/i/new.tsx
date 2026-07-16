import { loader, type InferLoader } from "@ilha/router";
import { LayerCard } from "areia";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "New Instance" });
  return {};
});

export default ilha.input<InferLoader<typeof clientLoad>>().render(() => (
  <div class="flex flex-col gap-4">
    <LayerCard>
      <LayerCard.Title>Add Instance</LayerCard.Title>
      <LayerCard.Content>Add a new instance</LayerCard.Content>
    </LayerCard>
  </div>
));

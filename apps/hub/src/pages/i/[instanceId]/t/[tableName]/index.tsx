import { loader, type InferLoader } from "@ilha/router";
import { LayerCard } from "areia";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "Data Grid" });
  return {};
});

export default ilha.input<InferLoader<typeof clientLoad>>().render(() => (
  <div class="flex flex-col gap-4">
    <LayerCard>
      <LayerCard.Title>Data Grid</LayerCard.Title>
      <LayerCard.Content>Data grid for the table</LayerCard.Content>
    </LayerCard>
  </div>
));

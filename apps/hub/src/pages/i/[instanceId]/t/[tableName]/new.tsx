import { loader, type InferLoader } from "@ilha/router";
import { LayerCard } from "areia";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "New Record" });
  return {};
});

export default ilha.input<InferLoader<typeof clientLoad>>().render(() => (
  <div class="flex flex-col gap-4">
    <LayerCard>
      <LayerCard.Title>New Record</LayerCard.Title>
      <LayerCard.Content>Form to create a new record</LayerCard.Content>
    </LayerCard>
  </div>
));

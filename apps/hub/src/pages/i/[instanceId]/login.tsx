import { loader, type InferLoader } from "@ilha/router";
import { LayerCard } from "areia";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ title: "Sign In" });
  return {};
});

export default ilha.input<InferLoader<typeof clientLoad>>().render(() => (
  <div class="flex flex-col gap-4">
    <LayerCard>
      <LayerCard.Title>Sign In</LayerCard.Title>
      <LayerCard.Content>Log in to your account.</LayerCard.Content>
    </LayerCard>
  </div>
));

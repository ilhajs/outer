import { defineLayout, loader } from "@ilha/router";
import { Toaster } from "areia/sonner";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ titleTemplate: (title) => `${title} · Outer Hub` });
});

export default defineLayout((Children) =>
  ilha.render(({ input }) => (
    <div class="flex min-h-screen flex-col">
      <Children {...input} />
      <Toaster />
    </div>
  )),
);

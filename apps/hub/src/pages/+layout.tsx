import { defineLayout, loader } from "@ilha/router";
import ilha from "ilha";

export const clientLoad = loader(({ head }) => {
  head({ titleTemplate: (title) => `${title} · Outer Hub` });
});

export default defineLayout((Children) =>
  ilha.render(({ input }) => {
    return <Children {...input} />;
  }),
);

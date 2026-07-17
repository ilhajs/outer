import { client } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { defineLayout, loader, useRoute } from "@ilha/router";
import { Resizable } from "areia";
import ilha from "ilha";

const { params } = useRoute();

export const clientLoad = loader(async ({ head }) => {
  const instance = getInstanceById(params().instanceId);
  head({ titleTemplate: (title) => `${title} · ${instance?.name}` });
  const authSession = await client.auth.getSession();
  console.log(">>>A", authSession);
});

export default defineLayout((Children) =>
  ilha.render(({ input }) => (
    <Resizable direction="horizontal" class="min-h-screen">
      <Resizable.Panel defaultSize={20}>Left</Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel>
        <Children {...input} />
      </Resizable.Panel>
    </Resizable>
  )),
);

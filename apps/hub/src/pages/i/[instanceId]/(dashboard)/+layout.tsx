import { Sidebar } from "$lib/components/sidebar";
import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { defineLayout, loader, navigate, type InferLoader } from "@ilha/router";
import { Resizable } from "areia";
import ilha from "ilha";

export const clientLoad = loader(async ({ head, params }) => {
  const { instanceId } = params;
  const instance = getInstanceById(instanceId);
  head({ titleTemplate: (title) => `${title} · ${instance?.name}` });
  if (!instance) {
    navigate(`/i`);
    return {};
  }
  const client = getClient(instance.url);
  const authSession = await client.auth.getSession();
  if (!authSession.data) {
    navigate(`/i/${instanceId}/login`);
    return {};
  }
  const meta = await client._admin.meta();
  return {
    meta,
    instance,
  };
});

export type LayoutLoader = InferLoader<typeof clientLoad>;

export default defineLayout((Children) =>
  ilha.input<LayoutLoader>().render(({ input }) => (
    <Resizable direction="horizontal" class="flex-1">
      <Resizable.Panel defaultSize={20} class="flex flex-col">
        <Sidebar meta={input.meta} instance={input.instance} />
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel>
        <Children {...input} />
      </Resizable.Panel>
    </Resizable>
  )),
);

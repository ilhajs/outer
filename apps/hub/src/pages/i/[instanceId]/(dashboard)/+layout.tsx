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

/** Last sidebar|main split — morph must not fall back to flex-grow 20 vs 1. */
let dashSplit: [number, number] = [20, 80];

function rememberDashSplit(layout: number[]) {
  if (layout.length >= 2 && layout[0]! > 0 && layout[1]! > 0) {
    dashSplit = [layout[0]!, layout[1]!];
  }
}

export default defineLayout((Children) =>
  ilha.input<LayoutLoader>().render(({ input }) => (
    <Resizable.Root
      key="dash-split"
      direction="horizontal"
      class="flex-1"
      onLayoutChange={rememberDashSplit}
    >
      {/*
        data-morph-preserve="style": Resizable owns flex-grow after mount; parent
        re-renders must not clobber it with template defaults (ilha morph).
      */}
      <Resizable.Panel
        defaultSize={dashSplit[0]}
        minSize={12}
        maxSize={40}
        data-morph-preserve="style"
        class="flex flex-col"
      >
        <Sidebar key="sidebar" meta={input.meta} instance={input.instance} />
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel
        defaultSize={dashSplit[1]}
        minSize={40}
        data-morph-preserve="style"
        class="flex min-w-0 flex-col overflow-hidden"
      >
        <Children {...input} />
      </Resizable.Panel>
    </Resizable.Root>
  )),
);

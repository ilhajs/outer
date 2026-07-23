import { Sidebar } from "$lib/components/sidebar";
import { fetchMeta } from "$lib/meta";
import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import {
  defineLayout,
  invalidate,
  loader,
  navigate,
  useRoute,
  type InferLoader,
} from "@ilha/router";
import { Button, Icon, LayerCard, LinkButton, Resizable } from "areia";
import ilha from "ilha";
import { RefreshCw, Settings, Unplug } from "lucide";

export const clientLoad = loader(async ({ head, params }) => {
  const { instanceId } = params;
  const instance = getInstanceById(instanceId);
  head({ titleTemplate: (title) => `${title} · ${instance?.name}` });
  if (!instance) {
    navigate(`/i`);
    return {};
  }
  const client = getClient(instance.url);
  try {
    const authSession = await client.auth.getSession();
    if (!authSession.data) {
      navigate(`/i/${instanceId}/login`);
      return { instance };
    }
    const meta = await fetchMeta(instance);
    return { meta, instance };
  } catch (error) {
    // Instance unreachable (wrong URL, server down, CORS). Render the
    // connection-error screen instead of the dashboard shell.
    return {
      instance,
      connectionError: error instanceof Error ? error.message : String(error),
    };
  }
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
  ilha
    .input<LayoutLoader>()
    .on("[data-retry-connection]@click", () => invalidate())
    .render(({ input }) => {
      // Settings must stay reachable while the instance is down — it's where
      // the user fixes a wrong URL. Everything else shows the error screen.
      const onSettings = useRoute().path().endsWith("/settings");
      if (input.connectionError && !onSettings) {
        return (
          <div class="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
            <LayerCard class="max-w-lg">
              <LayerCard.Title class="flex items-center gap-2">
                <Icon icon={Unplug} class="text-areia-danger size-5" />
                <span>Can't reach {input.instance?.name}</span>
              </LayerCard.Title>
              <LayerCard.Content class="flex flex-col gap-4">
                <p class="text-muted-foreground text-sm">
                  The instance at <code class="font-mono">{input.instance?.url}</code> did not
                  respond. It may be down, the URL may be wrong, or the server may not allow
                  requests from this origin.
                </p>
                <p class="bg-areia-control-background text-muted-foreground rounded-md p-2 font-mono text-xs break-all">
                  {input.connectionError}
                </p>
                <div class="flex items-center justify-end gap-2">
                  <LinkButton href="/i" variant="ghost">
                    All Instances
                  </LinkButton>
                  <LinkButton
                    href={`/i/${input.instance?.id}/settings`}
                    variant="secondary"
                    icon={<Icon icon={Settings} />}
                  >
                    Settings
                  </LinkButton>
                  <Button
                    type="button"
                    data-retry-connection
                    variant="primary"
                    icon={<Icon icon={RefreshCw} />}
                  >
                    Retry
                  </Button>
                </div>
              </LayerCard.Content>
            </LayerCard>
          </div>
        );
      }

      return (
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
      );
    }),
);

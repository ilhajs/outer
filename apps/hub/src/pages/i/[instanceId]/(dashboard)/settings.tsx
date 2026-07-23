import { getInstanceById } from "$lib/store";
/**
 * Instance settings. Currently hosts API token management (for future MCP
 * usage); more instance-level settings will live here over time. Tokens are
 * stored client-side for now — see `$lib/tokens`.
 */
import { generateToken, tokensForInstance, tokensStore, type ApiToken } from "$lib/tokens";
import { loader, navigate, type MergeLoaders } from "@ilha/router";
import { Button, ClipboardText, Dialog, Icon, Input, Table } from "areia";
import { toast } from "areia/sonner";
import { format } from "date-fns";
import ilha from "ilha";
import { KeyRound, Plus, Trash2 } from "lucide";
import { each, when } from "quando";

import type { clientLoad as layoutLoad } from "./+layout";

export const clientLoad = loader(({ head, params }) => {
  const { instanceId } = params;
  head({ title: "Settings" });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }
  return { instanceId };
});

export type SettingsLoader = MergeLoaders<[typeof layoutLoad, typeof clientLoad]>;

// ── Sections ────────────────────────────────────────────────────────────────

function SettingsSection(props: {
  title: string;
  description?: string;
  action?: unknown;
  children: unknown;
}) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-base font-semibold">{props.title}</h2>
          {props.description ? (
            <p class="text-muted-foreground text-sm">{props.description}</p>
          ) : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default ilha
  .input<SettingsLoader>()
  .state("draftName", "")
  .on("[data-create-token]@click", ({ input, state }) => {
    const name = state.draftName().trim();
    if (!name) return void toast.error("Enter a name for the token");

    const token: ApiToken = {
      id: crypto.randomUUID(),
      instanceId: input.instanceId!,
      name,
      token: generateToken(),
      createdAt: new Date().toISOString(),
    };
    tokensStore.add(token);
    state.draftName("");
    toast.success("Token created");
  })
  .on("[data-delete-token]@click", ({ event }) => {
    const id = (event.currentTarget as HTMLElement).getAttribute("data-delete-token");
    if (!id) return;
    tokensStore.remove(id);
    toast.success("Token deleted");
  })
  .render(({ input, state }) => {
    // The `@better-auth/api-key` plugin registers an `apikey` table via
    // `schema().auth({ apiKeys: true })` — its presence in meta is our signal
    // that headless key auth is available on this instance.
    const apiKeysEnabled = input.meta?.tables.some((table) => table.name === "apikey") ?? false;
    const tokens = tokensForInstance(input.instanceId ?? "");

    const createDialog = (
      <Dialog
        key="create-token"
        contentClass="grid gap-4 p-6"
        content={
          <>
            <Dialog.Title>Create API token</Dialog.Title>
            <Dialog.Description>
              Give the token a name so you can recognize it later. Copy it from the list — it stays
              masked and is never shown in full.
            </Dialog.Description>
            <Input
              name="name"
              label="Name"
              placeholder="MCP client"
              autocomplete="off"
              bind:value={state.draftName}
            />
            <div class="flex justify-end gap-2">
              <Dialog.Close>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Dialog.Close>
                <Button variant="primary" data-create-token>
                  Create token
                </Button>
              </Dialog.Close>
            </div>
          </>
        }
      >
        <Button variant="primary" icon={<Icon icon={Plus} />}>
          Create token
        </Button>
      </Dialog>
    );

    return (
      <div class="flex min-h-0 flex-1 flex-col gap-8 overflow-auto p-4">
        <header class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold">Settings</h1>
          <p class="text-muted-foreground text-sm">Manage settings for this instance.</p>
        </header>

        <SettingsSection
          title="API Tokens"
          description="Tokens for authenticating MCP clients against this instance. Store them securely — the value is only copyable from here."
          action={when(apiKeysEnabled, () => createDialog)}
        >
          {!apiKeysEnabled ? (
            <div class="border-areia-border flex flex-col gap-2 rounded-lg border border-dashed p-6 text-sm">
              <div class="flex items-center gap-2 font-medium">
                <Icon icon={KeyRound} class="text-muted-foreground size-4" />
                API keys are disabled
              </div>
              <p class="text-muted-foreground">
                This instance has no <code class="font-mono">apikey</code> table, so headless key
                authentication isn't available. Enable it on the server by declaring the table with{" "}
                <code class="font-mono">schema().auth(&#123; apiKeys: true &#125;)</code> and
                registering the <code class="font-mono">@better-auth/api-key</code> plugin, then
                reload.
              </p>
            </div>
          ) : tokens.length === 0 ? (
            <div class="border-areia-border text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-sm">
              <Icon icon={KeyRound} class="size-6" />
              No API tokens yet.
            </div>
          ) : (
            <div class="border-areia-border overflow-hidden rounded-lg border">
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Name</Table.Head>
                    <Table.Head>Token</Table.Head>
                    <Table.Head>Created</Table.Head>
                    <Table.Head class="w-0" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {each(tokens).as((token) => (
                    <Table.Row>
                      <Table.Cell class="font-medium">{token.name}</Table.Cell>
                      <Table.Cell>
                        <ClipboardText
                          key={`token-${token.id}`}
                          class="font-mono"
                          text="outer_••••••••••••"
                          textToCopy={token.token}
                        />
                      </Table.Cell>
                      <Table.Cell class="text-muted-foreground text-sm whitespace-nowrap">
                        {format(new Date(token.createdAt), "PP")}
                      </Table.Cell>
                      <Table.Cell class="w-0">
                        <Dialog
                          key={`delete-token-${token.id}`}
                          role="alertdialog"
                          contentClass="grid gap-4 p-6"
                          triggerClass="text-muted-foreground hover:text-areia-danger cursor-pointer"
                          content={
                            <>
                              <Dialog.Title>Delete token</Dialog.Title>
                              <Dialog.Description>
                                Delete <span class="font-medium">{token.name}</span>? Any client
                                using it will stop working. This cannot be undone.
                              </Dialog.Description>
                              <div class="flex justify-end gap-2">
                                <Dialog.Close>
                                  <Button variant="secondary">Cancel</Button>
                                </Dialog.Close>
                                <Dialog.Close>
                                  <Button variant="destructive" data-delete-token={token.id}>
                                    Delete
                                  </Button>
                                </Dialog.Close>
                              </div>
                            </>
                          }
                        >
                          <Icon icon={Trash2} class="size-4" />
                        </Dialog>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}
        </SettingsSection>
      </div>
    );
  });

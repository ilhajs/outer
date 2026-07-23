import { invalidateMeta, tryFetchMeta } from "$lib/meta";
/**
 * Instance settings. Hosts the local connection settings (name, URL) and API
 * token management. Tokens are real Better Auth API keys managed through the
 * client's `apiKeyClient` plugin (`client.auth.apiKey.*`).
 */
import { getClient } from "$lib/outer";
import { appStore, getInstanceById } from "$lib/store";
import type { ApiKey } from "@better-auth/api-key";
import { invalidate, loader, navigate, type MergeLoaders } from "@ilha/router";
import { Button, ClipboardText, Dialog, Icon, Input, Table } from "areia";
import { toast } from "areia/sonner";
import { format } from "date-fns";
import ilha from "ilha";
import { KeyRound, Plus, Trash2, Unplug } from "lucide";
import { each, when } from "quando";
import { z } from "zod";

import type { clientLoad as layoutLoad } from "./+layout";

export const clientLoad = loader(async ({ head, params }) => {
  const { instanceId } = params;
  head({ title: "Settings" });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  // Settings must render even when the instance is down (it's where a wrong
  // URL gets fixed), so meta and key fetches degrade instead of throwing.
  const meta = await tryFetchMeta(instance);
  const apiKeysEnabled = meta?.tables.some((table) => table.name === "apikey") ?? false;

  // `list` never returns the key value itself — only display metadata.
  let keys: Omit<ApiKey, "key">[] = [];
  let keysError: string | undefined;
  if (apiKeysEnabled) {
    const { data, error } = await getClient(instance.url).auth.apiKey.list();
    if (error) keysError = error.message;
    else keys = data.apiKeys;
  }

  return { instanceId, metaAvailable: meta !== null, apiKeysEnabled, keys, keysError };
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

/** Display form of a key: the stored leading characters, then a mask. */
function keyPreview(key: Pick<ApiKey, "prefix" | "start">): string {
  const start = [key.prefix, key.start].filter(Boolean).join("");
  return `${start || "•"}…`;
}

// ── Page ────────────────────────────────────────────────────────────────────

const InstanceFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an instance name"),
  url: z.url("Enter a valid URL, e.g. https://api.example.com"),
});

export default ilha
  .input<SettingsLoader>()
  .state("draftName", "")
  .state("createdKey", "")
  .state("busy", false)
  .on("#instance-form@submit", async ({ input, event }) => {
    event.preventDefault();
    const instance = getInstanceById(input.instanceId ?? "");
    if (!instance) return;

    const formData = new FormData(event.target as HTMLFormElement);
    const result = InstanceFormSchema.safeParse({
      name: formData.get("name"),
      url: formData.get("url"),
    });
    if (!result.success) return void toast.error(result.error.issues[0]!.message);

    const { name, url } = result.data;
    if (name === instance.name && url === instance.url) {
      return void toast.info("No changes to save");
    }
    invalidateMeta(instance.url);
    appStore.updateInstance({ id: instance.id, name, url });
    toast.success("Instance updated");
    await invalidate();
  })
  .on("[data-create-token]@click", async ({ input, state }) => {
    if (state.busy()) return;
    const name = state.draftName().trim();
    if (!name) return void toast.error("Enter a name for the token");
    const instance = getInstanceById(input.instanceId ?? "");
    if (!instance) return;

    state.busy(true);
    try {
      const { data, error } = await getClient(instance.url).auth.apiKey.create({ name });
      if (error) return void toast.error(error.message);
      state.draftName("");
      // Shown once in the dialog; the server only stores the hash.
      state.createdKey(data.key);
      toast.success("Token created");
    } finally {
      state.busy(false);
    }
  })
  .on("[data-token-done]@click", async ({ state }) => {
    state.createdKey("");
    await invalidate();
  })
  .on("[data-delete-token]@click", async ({ input, event }) => {
    const id = (event.currentTarget as HTMLElement).getAttribute("data-delete-token");
    const instance = getInstanceById(input.instanceId ?? "");
    if (!id || !instance) return;
    const { error } = await getClient(instance.url).auth.apiKey.delete({ keyId: id });
    if (error) return void toast.error(error.message);
    toast.success("Token deleted");
    await invalidate();
  })
  .render(({ input, state }) => {
    const { metaAvailable = false, apiKeysEnabled = false, keys = [], keysError } = input;
    const createdKey = state.createdKey();

    const createDialog = (
      <Dialog
        key="create-token"
        contentClass="grid gap-4 p-6"
        content={when(
          createdKey !== "",
          () => (
            <>
              <Dialog.Title>Copy your token</Dialog.Title>
              <Dialog.Description>
                This is the only time the token is shown — the server keeps just a hash. Copy it now
                and store it securely.
              </Dialog.Description>
              <ClipboardText
                key="created-key"
                class="font-mono break-all"
                text={createdKey}
                textToCopy={createdKey}
              />
              <div class="flex justify-end">
                <Dialog.Close>
                  <Button variant="primary" data-token-done>
                    Done
                  </Button>
                </Dialog.Close>
              </div>
            </>
          ),
          () => (
            <>
              <Dialog.Title>Create API token</Dialog.Title>
              <Dialog.Description>
                Give the token a name so you can recognize it later. The token value is shown once
                after creation.
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
                <Button variant="primary" data-create-token disabled={state.busy()}>
                  {when(
                    state.busy(),
                    () => "Creating…",
                    () => "Create token",
                  )}
                </Button>
              </div>
            </>
          ),
        )}
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
          title="Instance"
          description="How Hub connects to this instance. Both values are stored locally in this browser."
        >
          <form id="instance-form" class="flex max-w-md flex-col gap-2">
            <Input
              name="name"
              label="Instance Name"
              value={getInstanceById(input.instanceId ?? "")?.name ?? ""}
              autocomplete="off"
            />
            <Input
              type="url"
              name="url"
              label="Instance URL"
              value={getInstanceById(input.instanceId ?? "")?.url ?? ""}
              placeholder="https://"
              autocomplete="off"
            />
            <div class="flex justify-end">
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection
          title="API Tokens"
          description="Better Auth API keys for headless clients (MCP, CI, server-to-server). Each key authenticates as your user."
          action={when(apiKeysEnabled, () => createDialog)}
        >
          {!metaAvailable ? (
            <div class="border-areia-border text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm">
              <Icon icon={Unplug} class="size-4" />
              The instance is unreachable, so tokens can't be managed right now.
            </div>
          ) : !apiKeysEnabled ? (
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
          ) : keysError ? (
            <div class="border-areia-border text-areia-danger rounded-lg border border-dashed p-6 text-sm">
              Failed to load tokens: {keysError}
            </div>
          ) : keys.length === 0 ? (
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
                    <Table.Head>Key</Table.Head>
                    <Table.Head>Created</Table.Head>
                    <Table.Head class="w-0" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {each(keys).as((key) => (
                    <Table.Row>
                      <Table.Cell class="font-medium">{key.name ?? "—"}</Table.Cell>
                      <Table.Cell class="text-muted-foreground font-mono text-sm">
                        {keyPreview(key)}
                      </Table.Cell>
                      <Table.Cell class="text-muted-foreground text-sm whitespace-nowrap">
                        {format(new Date(key.createdAt), "PP")}
                      </Table.Cell>
                      <Table.Cell class="w-0">
                        <Dialog
                          key={`delete-token-${key.id}`}
                          role="alertdialog"
                          contentClass="grid gap-4 p-6"
                          content={
                            <>
                              <Dialog.Title>Delete token</Dialog.Title>
                              <Dialog.Description>
                                Delete{" "}
                                <span class="font-medium">{key.name ?? keyPreview(key)}</span>? Any
                                client using it will stop working. This cannot be undone.
                              </Dialog.Description>
                              <div class="flex justify-end gap-2">
                                <Dialog.Close>
                                  <Button variant="secondary">Cancel</Button>
                                </Dialog.Close>
                                <Dialog.Close>
                                  <Button variant="destructive" data-delete-token={key.id}>
                                    Delete
                                  </Button>
                                </Dialog.Close>
                              </div>
                            </>
                          }
                        >
                          <span
                            class="text-muted-foreground hover:text-areia-danger hover:bg-areia-control-hover inline-flex size-8 cursor-pointer items-center justify-center rounded-md"
                            aria-label={`Delete ${key.name ?? "token"}`}
                            title="Delete token"
                          >
                            <Icon icon={Trash2} class="size-4" />
                          </span>
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

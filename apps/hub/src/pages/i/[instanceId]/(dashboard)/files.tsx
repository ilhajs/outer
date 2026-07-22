/**
 * Storage browser — a visual grid of every file uploaded to the instance,
 * read through the admin API (`_admin.data.*` over the `file` table). Selecting
 * a card opens a detail pane, mirroring the record master–detail shell.
 */
import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { invalidate, loader, navigate, type InferLoader } from "@ilha/router";
import { withQuery } from "@ilha/store/query";
import {
  Button,
  ClipboardText,
  Dialog,
  Icon,
  Input,
  LinkButton,
  Pagination,
  Resizable,
} from "areia";
import { toast } from "areia/sonner";
import { format } from "date-fns";
import ilha from "ilha";
import { Download, File as FileIcon, Trash2, X } from "lucide";
import { each, when } from "quando";

type FileRow = {
  id: string;
  key: string;
  name: string;
  type: string;
  size: number;
  userId?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

const PAGE_SIZE = 60;

// ── Loader ────────────────────────────────────────────────────────────────────

export const clientLoad = loader(async ({ head, params, url }) => {
  const { instanceId } = params;
  head({ title: "Files" });

  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate("/i");
    return {};
  }

  const client = getClient(instance.url);
  const meta = await client._admin.meta();
  // `.files()` registers a `file` table; without it there's nothing to browse.
  const hasFiles = meta.tables.some((table) => table.name === "file");
  if (!hasFiles) {
    return { instanceId, instanceUrl: instance.url, hasFiles: false as const };
  }

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const list = await client._admin.data.list({
    table: "file",
    orderBy: [{ createdAt: "desc" }],
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  return {
    instanceId,
    instanceUrl: instance.url,
    hasFiles: true as const,
    files: list.data as unknown as FileRow[],
    count: list.count,
    page,
  };
});

export type FilesLoader = InferLoader<typeof clientLoad>;

// ── Formatting ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : format(date, "PPpp");
}

/** SVG is served as an attachment (CSP sandbox), so it never renders inline. */
function isPreviewable(type: string): boolean {
  return type.startsWith("image/") && type !== "image/svg+xml";
}

/** Download route for a file — `.files()` mounts it at `/files/:id` by default. */
function fileHref(instanceUrl: string, id: string): string {
  return new URL(`/files/${encodeURIComponent(id)}`, instanceUrl).toString();
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function FileCard(props: { file: FileRow; instanceUrl: string; selected: boolean }) {
  const { file, instanceUrl, selected } = props;
  const href = fileHref(instanceUrl, file.id);
  return (
    <button
      type="button"
      data-select-file={file.id}
      class={`border-areia-border hover:border-areia-ring group flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
        selected ? "border-areia-ring ring-areia-ring/40 ring-2" : ""
      }`}
    >
      <div class="bg-areia-control-background flex aspect-square items-center justify-center overflow-hidden">
        {when(
          isPreviewable(file.type),
          () => (
            <img src={href} alt={file.name} loading="lazy" class="size-full object-cover" />
          ),
          () => (
            <div class="text-muted-foreground flex flex-col items-center gap-1">
              <Icon icon={FileIcon} class="size-8" />
              <span class="max-w-full truncate px-2 text-[10px] uppercase">
                {file.type.split("/").pop()}
              </span>
            </div>
          ),
        )}
      </div>
      <div class="flex flex-col gap-0.5 p-2">
        <span class="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </span>
        <span class="text-muted-foreground text-xs tabular-nums">{formatBytes(file.size)}</span>
      </div>
    </button>
  );
}

function DetailRow(props: { label: string; children: unknown }) {
  return (
    <div class="grid gap-0.5">
      <span class="text-muted-foreground text-xs">{props.label}</span>
      <span class="font-mono text-sm break-all">{props.children}</span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default ilha
  .input<FilesLoader>()
  .state("selectedId", "")
  .state("saving", false)
  .on("[data-select-file]@click", ({ state, event }) => {
    const id = (event.currentTarget as HTMLElement).getAttribute("data-select-file");
    if (id !== null) state.selectedId(id);
  })
  .on("[data-close-detail]@click", ({ state }) => state.selectedId(""))
  .on("[data-save-file]@click", () => {
    document.querySelector<HTMLFormElement>("#file-form")?.requestSubmit();
  })
  .on("#file-form@submit", async ({ input, state, event }) => {
    event.preventDefault();
    const id = state.selectedId();
    const file = input.files?.find((f) => f.id === id);
    if (!file) return;

    const name = String(new FormData(event.target as HTMLFormElement).get("name") ?? "").trim();
    if (!name) return void toast.error("Name cannot be empty");
    if (name === file.name) return void toast.info("No changes to save");

    state.saving(true);
    try {
      const client = getClient(getInstanceById(input.instanceId!)!.url);
      await client._admin.data.update({ table: "file", where: { id }, data: { name } });
      toast.success("File renamed");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename file");
    } finally {
      state.saving(false);
    }
  })
  .on("[data-delete-file]@click", async ({ input, state, event }) => {
    const id = (event.currentTarget as HTMLElement).getAttribute("data-delete-file");
    if (!id) return;
    try {
      const client = getClient(getInstanceById(input.instanceId!)!.url);
      await client._admin.data.delete({ table: "file", where: { id } });
      toast.success("File deleted");
      state.selectedId("");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete file");
    }
  })
  .render(({ input, state }) => {
    if (input.hasFiles === false) {
      return (
        <div class="text-muted-foreground p-4 text-sm">
          This instance does not have file storage. Enable it by calling <code>.files()</code> on
          the <code>Outer</code> instance.
        </div>
      );
    }

    const { instanceUrl, files = [], count = 0, page = 1, instanceId } = input;
    const selectedId = state.selectedId();
    const selected = files.find((file) => file.id === selectedId);
    const pageHref = (target: number) =>
      withQuery(`/i/${instanceId}/files`, { page: target > 1 ? target : null });

    const grid = (
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <header class="flex items-center justify-between gap-2 p-2">
          <h2 class="flex items-baseline gap-2 text-lg font-semibold">
            Files
            <span class="text-muted-foreground text-sm font-normal tabular-nums">
              {count} file{count === 1 ? "" : "s"}
            </span>
          </h2>
        </header>

        <div class="min-h-0 flex-1 overflow-auto p-2">
          {when(
            files.length > 0,
            () => (
              <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                {each(files).as((file) => (
                  <FileCard
                    file={file}
                    instanceUrl={instanceUrl!}
                    selected={file.id === selectedId}
                  />
                ))}
              </div>
            ),
            () => (
              <span class="text-muted-foreground text-sm">No files uploaded yet.</span>
            ),
          )}
        </div>

        {when(count > PAGE_SIZE, () => (
          <footer class="border-areia-border border-t p-3">
            <Pagination
              key="files-pagination"
              page={page}
              perPage={PAGE_SIZE}
              totalCount={count}
              setPage={(target: number) => navigate(pageHref(target))}
            >
              <Pagination.Info page={page} perPage={PAGE_SIZE} totalCount={count} />
              <div class="grow"></div>
              <Pagination.Controls page={page} perPage={PAGE_SIZE} totalCount={count} />
            </Pagination>
          </footer>
        ))}
      </div>
    );

    if (!selected) {
      return <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{grid}</div>;
    }

    const href = fileHref(instanceUrl!, selected.id);
    const detail = (
      <div class="flex h-full min-h-0 flex-col">
        <header class="border-areia-border flex items-center justify-between gap-2 border-b p-3">
          <h3 class="min-w-0 truncate text-base font-semibold" title={selected.name}>
            {selected.name}
          </h3>
          <Button
            type="button"
            data-close-detail
            variant="ghost"
            shape="square"
            size="sm"
            aria-label="Close"
            title="Close"
          >
            <Icon icon={X} class="size-4" />
          </Button>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
          <div class="bg-areia-control-background flex aspect-video items-center justify-center overflow-hidden rounded-lg">
            {when(
              isPreviewable(selected.type),
              () => (
                <img src={href} alt={selected.name} class="max-h-full max-w-full object-contain" />
              ),
              () => (
                <Icon icon={FileIcon} class="text-muted-foreground size-12" />
              ),
            )}
          </div>

          <form id="file-form" class="grid gap-1.5">
            <label class="text-sm font-medium" for="file-name">
              name
            </label>
            <Input id="file-name" name="name" value={selected.name} autocomplete="off" />
          </form>

          <div class="grid gap-3">
            <DetailRow label="type">{selected.type}</DetailRow>
            <DetailRow label="size">{formatBytes(selected.size)}</DetailRow>
            <DetailRow label="id">{selected.id}</DetailRow>
            <DetailRow label="key">{selected.key}</DetailRow>
            {when(selected.userId != null, () => (
              <DetailRow label="userId">{selected.userId}</DetailRow>
            ))}
            <DetailRow label="createdAt">{formatDate(selected.createdAt)}</DetailRow>
            <DetailRow label="updatedAt">{formatDate(selected.updatedAt)}</DetailRow>
            <div class="grid gap-0.5">
              <span class="text-muted-foreground text-xs">url</span>
              <ClipboardText
                key={`file-url-${selected.id}`}
                class="font-mono"
                text={href}
                textToCopy={href}
              />
            </div>
          </div>
        </div>

        <div class="border-areia-border flex items-center justify-between gap-2 border-t p-3">
          <Dialog
            key={`delete-file-${selected.id}`}
            role="alertdialog"
            contentClass="grid gap-4 p-6"
            content={
              <>
                <Dialog.Title>Delete file</Dialog.Title>
                <Dialog.Description>
                  Delete <span class="font-medium">{selected.name}</span>? This removes the record
                  and cannot be undone.
                </Dialog.Description>
                <div class="flex justify-end gap-2">
                  <Dialog.Close>
                    <Button variant="secondary">Cancel</Button>
                  </Dialog.Close>
                  <Dialog.Close>
                    <Button variant="destructive" data-delete-file={selected.id}>
                      Delete
                    </Button>
                  </Dialog.Close>
                </div>
              </>
            }
          >
            <span class="text-muted-foreground hover:text-areia-danger inline-flex cursor-pointer items-center gap-1 text-sm">
              <Icon icon={Trash2} class="size-4" />
              Delete
            </span>
          </Dialog>
          <div class="flex items-center gap-2">
            <LinkButton href={href} external variant="secondary" icon={<Icon icon={Download} />}>
              Download
            </LinkButton>
            <Button type="button" data-save-file variant="primary" disabled={state.saving()}>
              {when(
                state.saving(),
                () => "Saving…",
                () => "Save",
              )}
            </Button>
          </div>
        </div>
      </div>
    );

    return (
      <Resizable.Root key="files-split" direction="horizontal" class="flex-1">
        <Resizable.Panel
          defaultSize={68}
          minSize={35}
          data-morph-preserve="style"
          class="flex min-w-0 flex-col overflow-hidden"
        >
          {grid}
        </Resizable.Panel>
        <Resizable.Handle />
        <Resizable.Panel
          defaultSize={32}
          minSize={18}
          maxSize={55}
          data-morph-preserve="style"
          class="flex min-w-0 flex-col overflow-hidden"
        >
          {detail}
        </Resizable.Panel>
      </Resizable.Root>
    );
  });

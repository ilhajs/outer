import type { Instance } from "$lib/store";
import { useRoute } from "@ilha/router";
import type { AdminMeta } from "@outerjs/server";
import { Button, Icon, LinkButton } from "areia";
import ilha from "ilha";
import { ArrowRightLeft, BookOpen, FolderOpen, Home, MoreVertical, Settings } from "lucide";
import { each, when } from "quando";

const { params, path } = useRoute();

export const Sidebar = ilha
  .input<{ meta: AdminMeta | undefined; instance: Instance | undefined }>()
  .render(({ input }) => (
    <div class="flex flex-1 flex-col justify-between p-2">
      <div class="flex flex-col gap-4">
        <div class="flex items-center">
          <LinkButton
            href={`/i/${input.instance?.id}`}
            size="lg"
            icon={<img src="/logo.svg" class="size-6" />}
            class="flex-1"
          >
            Hub
          </LinkButton>
          <Button variant="ghost" shape="square" icon={<Icon icon={MoreVertical} />} />
        </div>
        <LinkButton
          href={`/i/${input.instance?.id}`}
          variant={path() === `/i/${input.instance?.id}` ? "outline" : undefined}
          icon={<Icon icon={Home} />}
          class="w-full"
        >
          Dashboard
        </LinkButton>
        <div class="flex flex-col">
          <div class="text-areia-surface-muted-foreground mb-1 text-sm font-semibold">Tables</div>
          {each(input.meta?.tables ?? []).as((table) => {
            const isActive = params().tableName === table.name;
            return (
              <LinkButton
                variant={isActive ? "outline" : undefined}
                href={`/i/${input.instance?.id}/t/${table.name}`}
                class="w-full"
              >
                {table.name}
              </LinkButton>
            );
          })}
        </div>
        <div class="flex flex-col">
          <div class="text-areia-surface-muted-foreground mb-1 text-sm font-semibold">System</div>
          {when(input.meta?.tables.some((table) => table.name === "file") ?? false, () => (
            <LinkButton
              variant={path().endsWith("/files") ? "outline" : undefined}
              href={`/i/${input.instance?.id}/files`}
              class="w-full"
              icon={<Icon icon={FolderOpen} />}
            >
              Files
            </LinkButton>
          ))}
          {when(input.meta?.openapi ?? false, () => (
            <LinkButton
              variant={path().endsWith("/scalar") ? "outline" : undefined}
              href={`/i/${input.instance?.id}/scalar`}
              class="w-full"
              icon={<Icon icon={BookOpen} />}
            >
              API Reference
            </LinkButton>
          ))}
          <LinkButton
            variant={path().endsWith("/settings") ? "outline" : undefined}
            href={`/i/${input.instance?.id}/settings`}
            class="w-full"
            icon={<Icon icon={Settings} />}
          >
            Settings
          </LinkButton>
        </div>
      </div>
      <LinkButton href="/i" variant="outline" class="w-full" icon={<Icon icon={ArrowRightLeft} />}>
        {input.instance?.name}
      </LinkButton>
    </div>
  ));

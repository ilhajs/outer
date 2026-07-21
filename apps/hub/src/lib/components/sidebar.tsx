import type { Instance } from "$lib/store";
import { useRoute } from "@ilha/router";
import type { AdminMeta } from "@outerjs/server";
import { Button, Icon, LinkButton } from "areia";
import ilha from "ilha";
import { ArrowRightLeft, BookOpen, MoreVertical } from "lucide";
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
        <div class="flex flex-col">
          <div class="text-sm">Tables</div>
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
      </div>
      <LinkButton href="/i" variant="outline" class="w-full" icon={<Icon icon={ArrowRightLeft} />}>
        {input.instance?.name}
      </LinkButton>
    </div>
  ));

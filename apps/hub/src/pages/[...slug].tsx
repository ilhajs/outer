import { loader, useRoute } from "@ilha/router";
import { Icon, LinkButton } from "areia";
import ilha from "ilha";
import { ChevronLeft, Compass } from "lucide";

export const clientLoad = loader(({ head }) => {
  head({ title: "Page Not Found" });
});

export default ilha.render(() => {
  const { path } = useRoute();
  return (
    <section class="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <Icon icon={Compass} class="text-muted-foreground size-10" />
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">Page not found</h1>
        <p class="text-muted-foreground text-sm">
          Nothing lives at <code class="font-mono">{path()}</code>.
        </p>
      </div>
      <LinkButton href="/i" variant="outline" icon={<Icon icon={ChevronLeft} />}>
        Back to Instances
      </LinkButton>
    </section>
  );
});

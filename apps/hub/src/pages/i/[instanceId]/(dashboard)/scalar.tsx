/**
 * Interactive API reference for the instance, rendered by Scalar from the
 * instance's `/openapi.json` — only served when the instance enabled
 * `.openapi()`, which `_admin.meta` reports as `openapi`.
 */
import { getInstanceById } from "$lib/store";
import { loader, navigate, type MergeLoaders } from "@ilha/router";
import { createApiReference } from "@scalar/api-reference";

// Scalar ships its own stylesheet; `createApiReference` does not inject it.
import "@scalar/api-reference/style.css";
import ilha from "ilha";
import { when } from "quando";

import type { clientLoad as layoutLoad } from "./+layout";

export const clientLoad = loader(({ head, params }) => {
  const { instanceId } = params;
  const instance = getInstanceById(instanceId);
  head({ title: "API Reference" });
  if (!instance) {
    navigate("/i");
    return {};
  }
  return { url: new URL("/openapi.json", instance.url).toString() };
});

export type ScalarLoader = MergeLoaders<[typeof layoutLoad, typeof clientLoad]>;

export default ilha
  .input<ScalarLoader>()
  .onMount(({ input }) => {
    if (!input.url || !input.meta?.openapi) return;
    const mount = document.querySelector<HTMLElement>("[data-scalar-mount]");
    if (!mount) return;
    const app = createApiReference(mount, { url: input.url });
    return () => app.destroy();
  })
  // min-h-0 lets the scroll container shrink inside the flex column instead of
  // growing the page — Scalar's own root is tall and would otherwise overflow.
  .render(({ input }) => (
    <div class="max-h-screen min-h-0 flex-1 overflow-auto">
      {when(
        input.meta?.openapi ?? false,
        () => (
          <div data-scalar-mount />
        ),
        () => (
          <div class="text-muted-foreground p-4 text-sm">
            This instance does not expose an OpenAPI document. Enable it by calling{" "}
            <code>.openapi()</code> on the <code>Outer</code> instance.
          </div>
        ),
      )}
    </div>
  ));

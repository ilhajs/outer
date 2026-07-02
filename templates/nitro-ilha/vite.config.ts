import { createRequire } from "node:module";
import path from "node:path";

import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// WebContainer (StackBlitz) doesn't fully support node:async_hooks'
// AsyncLocalStorage context propagation, which better-auth's session-refresh
// path relies on — causing "No request state found" errors there specifically
// (confirmed: doesn't happen in a real Node deployment). better-auth ships its
// own single-threaded polyfill for exactly this class of environment (used
// normally for Convex/edge/browser). It trades away safety under concurrent
// requests (see its own "short-lived and single-threaded" assumption) for
// working at all in WebContainer, so this is opt-in only via
// FORCE_ALS_POLYFILL=true — never enable this for a real deployment.
const forceAlsPolyfill = process.env.FORCE_ALS_POLYFILL === "true";
const alsPolyfillAlias = forceAlsPolyfill
  ? [
      {
        find: "@better-auth/core/async_hooks",
        replacement: path.join(
          path.dirname(createRequire(import.meta.url).resolve("@better-auth/core/async_hooks")),
          "pure.index.mjs",
        ),
      },
    ]
  : [];

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages(), tailwindcss(), nitro()],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["better-auth", "@better-auth/core", "better-call"],
    alias: alsPolyfillAlias,
  },
  nitro: {
    serverDir: "./src",
    runtimeConfig: {
      authSecret: "",
    },
    experimental: {
      tasks: true,
    },
    storage: {
      fs: {
        driver: "fs-lite",
        base: "./.outer/data",
      },
    },
  },
  server: {
    watch: {
      usePolling: true,
      ignored: ["**/.outer/**"],
    },
  },
});

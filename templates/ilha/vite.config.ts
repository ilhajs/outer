import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages(), tailwindcss(), nitro()],
  resolve: {
    tsconfigPaths: true,
  },
  nitro: {
    serverDir: "./src",
    runtimeConfig: {
      authSecret: "",
    },
    experimental: {
      tasks: true,
    },
    // Backs `.files()` uploads, reached via `useStorage("fs")` in src/server.ts.
    // For object storage in production, swap this driver for `s3` and keep the local
    // filesystem in dev by moving this mount to `devStorage` — it merges on top.
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

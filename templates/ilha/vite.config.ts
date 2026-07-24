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
  optimizeDeps: {
    // PGlite's WASM can't be pre-bundled — leave it for the native loader.
    exclude: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  },
  nitro: {
    serverDir: "./src",
    runtimeConfig: {
      authSecret: "",
    },
    experimental: {
      tasks: true,
    },
    // Keep PGlite out of the JS bundle and copy the full packages (wasm, data,
    // vector.tar.gz) into `.output/server/node_modules` so `import.meta.url`
    // asset lookups resolve at runtime. Same pattern as sharp / better-sqlite3.
    // https://nitro.build/config#tracedeps
    traceDeps: ["@electric-sql/pglite*", "@electric-sql/pglite-pgvector*"],
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

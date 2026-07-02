import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages(), tailwindcss(), nitro()],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["better-auth", "@better-auth/core", "better-call"],
  },
  nitro: {
    serverDir: "./src",
    runtimeConfig: {
      authSecret: "",
    },
    // PGlite loads its .wasm/.data files at runtime via
    // `new URL("./pglite.data", import.meta.url)` — Nitro's default build
    // tracer only follows static imports, so it misses these and production
    // builds fail with ENOENT. "pkg*" forces a full trace that copies every
    // file in the package instead of only statically-discovered ones.
    traceDeps: ["@electric-sql/pglite*"],
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

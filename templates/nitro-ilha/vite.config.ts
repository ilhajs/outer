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
      // Outer's PGlite data dir (.outer/pglite) and Nitro's fs storage
      // (.outer/data) live under the project root — every DB write/task
      // touches files there, which would otherwise trigger spurious
      // HMR/reload cycles (e.g. on every form submission that hits auth).
      ignored: ["**/.outer/**"],
    },
  },
});

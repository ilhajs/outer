import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";

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
    },
  },
});

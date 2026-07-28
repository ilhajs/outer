import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";
import ilha from "@ilha/astro";
import tailwindcss from "@tailwindcss/vite";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

const nimbusConfig = defineNimbusConfig({
  site: "https://outer.now",
  title: "Outer",
  description:
    "Outer is the open-source backend you own 100% — embedded Postgres, auth, typed RPC, and generated CRUD in a single deploy.",
  locale: "en",
  github: "https://github.com/ilhajs/outer",
  editPattern: "https://github.com/ilhajs/outer/edit/main/apps/website/{path}",
  socialImageAlt: "Outer documentation preview",
  sidebar: {
    items: [
      // Root autogenerate turns getting-started/, outer/, schema/, integrations/ into groups via each folder's index (or the folder name).
      { autogenerate: { collection: "docs" } },
    ],
  },
});

export default defineConfig({
  output: "static",
  redirects: {
    "/outer": "/outer/server",
    "/outer/api-reference": "/getting-started/api-reference",
    "/outer/hub": "/getting-started/hub",
    "/getting-started": "/getting-started/introduction",
    "/schema": "/schema/defining-schema",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    icon(),
    ilha(),
    nimbus(nimbusConfig, {
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      markdown: {
        hastPlugins: [tableScroll()],
      },
    }),
  ],
});

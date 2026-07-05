import { imprensa } from "imprensa";
import { defineConfig } from "vite";
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    imprensa({
      hostname: "https://outer.now",
      siteName: "Outer",
      repo: "https://github.com/ilhajs/outer",
      repoPath: "apps/website",
      shiki: {
        themes: { light: "night-owl-light", dark: "houston" },
        langs: ["typescript", "tsx", "mdx", "shell", "yaml", "json"],
      },
      head: {
        title: "Outer — Agent-first tiny backend",
      },
      socials: [
        { service: "x", url: "https://x.com/ilha_js" },
        { service: "discord", url: "https://discord.gg/WnVTMCTz74" },
        { service: "github", url: "https://github.com/ilhajs/imprensa" },
      ],
    }),
  ],
});

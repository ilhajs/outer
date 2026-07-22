import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    pglite: "src/pglite.ts",
    schema: "src/entry/schema.ts",
    secrets: "src/entry/secrets.ts",
    storage: "src/entry/storage.ts",
  },
  platform: "node",
  dts: true,
  // Don't ship minified library code — avoids double-minification edge cases
  // (e.g. self-referencing class expressions) when consumers' own bundlers
  // re-process this output. Let the consumer's bundler minify at the app level.
  minify: false,
});

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  dts: true,
  // Don't ship minified library code — avoids double-minification edge cases
  // (e.g. self-referencing class expressions) when consumers' own bundlers
  // re-process this output. Let the consumer's bundler minify at the app level.
  minify: false,
  // Bundle better-auth (and its @better-auth/core dependency) instead of
  // leaving it external. @better-auth/core uses AsyncLocalStorage-based
  // module-singleton state for request context — if the consumer's package
  // manager installs a second, physically separate copy of it (common with
  // URL/tarball-sourced dependencies, which npm can't dedupe as reliably as
  // registry packages), the copy that sets request state and the copy that
  // reads it are different instances, and every request fails with
  // "No request state found". Bundling makes @outerjs/server self-contained
  // for this dependency regardless of how the consumer's installer hoists it.
  deps: {
    alwaysBundle: ["better-auth", "@better-auth/core"],
  },
});

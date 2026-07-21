/** Landing card samples → Shiki HTML via virtual module `imprensa/landing-shiki` (read automatically when this file exists). */

export const landingSnippets = {
  hero: {
    lang: "typescript",
    code: `const server = new Outer({ db: pglite() })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .resource("post", {
    permissions: { create: "authenticated", update: "owner" },
    ownerColumn: "userId",
  })
  .build();

serve({ fetch: (req) => server.handle(req) });`,
  },
  client: {
    lang: "typescript",
    code: `import type { InferRouter } from "@outerjs/server";
import { createClient } from "@outerjs/sdk";

const client = createClient<InferRouter<typeof server>>({
  baseUrl: "http://localhost:3000",
}).build();

const me = await client.user.me();
// ^ typed end-to-end. No codegen, nothing to keep in sync.`,
  },
  fileTree: {
    lang: "typescript",
    code: `.resource("post", {
  permissions: { create: "authenticated", update: "owner" },
  ownerColumn: "userId",
})
// -> post.list, post.get, post.create,
//    post.update, post.delete`,
  },
  mdx: {
    lang: "typescript",
    code: `.auth({ secret: process.env.AUTH_SECRET! })
// the session is resolved once per request — no middleware
.procedure("user.me", (base) =>
  base.handler(({ context }) => context.user),
  { permission: "authenticated" },
)`,
  },
  build: {
    lang: "shell",
    code: `$ npm run deploy

# templates/cloudflare   -> wrangler deploy
# templates/vercel-neon  -> vercel deploy --prod
# any other host         -> node dist/server.js`,
  },
  files: {
    lang: "typescript",
    code: `// server — one call mounts the whole upload surface
.files({ maxBytes: 10 * 1024 * 1024 })

// client — no FormData, no upload endpoint to write
const { url } = await client.file.upload({
  file,
  attach: { table: "post", entityId: post.id },
});`,
  },
  realtime: {
    lang: "typescript",
    code: `.procedure("post.live", (base) =>
  base.handler(async function* ({ signal }) {
    for await (const row of postEvents.subscribe("created", { signal })) {
      yield withEventMeta(row, { id: String(row.id) });
    }
  }),
)`,
  },
} as const;

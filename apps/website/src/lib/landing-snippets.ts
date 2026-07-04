/** Landing card samples → Shiki HTML via virtual module `imprensa/landing-shiki` (read automatically when this file exists). */

export const landingSnippets = {
  fileTree: {
    lang: "typescript",
    code: `.schema(v1_0)
.resource("post", {
  permissions: {
    list: "public",
    create: "authenticated",
    update: "owner",
    delete: "owner",
  },
  ownerColumn: "userId",
})
// -> post.list, post.get, post.create,
//    post.update, post.delete`,
  },
  mdx: {
    lang: "typescript",
    code: `.auth({ secret: process.env.AUTH_SECRET! })
.middleware(async ({ context, next }) => {
  const session = await context.auth.api
    .getSession({ headers: context.headers });
  return next({ context: { user: session?.user } });
})`,
  },
  build: {
    lang: "shell",
    code: `$ npm run deploy

# templates/cloudflare   -> wrangler deploy
# templates/vercel-neon  -> vercel deploy --prod`,
  },
  realtime: {
    lang: "typescript",
    code: `.procedure("post.live", (base) =>
  base
    .output(eventIterator(z.object({ id: z.number() })))
    .handler(async function* ({ signal }) {
      for await (const row of postEvents.subscribe(
        "created",
        { signal },
      )) {
        yield withEventMeta(row, { id: String(row.id) });
      }
    }),
)`,
  },
} as const;

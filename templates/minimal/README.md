# Outer + srvx

The smallest possible Outer server: no frontend, no framework — just `await new Outer(...).start()` behind [srvx](https://srvx.h3.dev), a tiny universal fetch-based HTTP server, bundled with [tsdown](https://tsdown.dev).

`outer.handle` is a plain `(request: Request) => Promise<Response>`, so `srvx` is only one option here — swap it out freely:

```ts
// Bun, no dependency needed at all:
Bun.serve({ fetch: (req) => outer.handle(req) });

// Node (18+), via srvx's node adapter or any other fetch-to-node shim:
import { serve } from "srvx/node";
serve({ fetch: (req) => outer.handle(req) });
```

## Requirements

- Node.js 20+ (or Bun/Deno)

## Getting started

```bash
cp .env.example .env # copy and adjust as needed
npm install
npm run dev
```

This starts `tsdown --watch` and re-runs the built server on every change. Open [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) to confirm it's up.

## Scripts

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `npm run dev`   | Build + watch with tsdown, restart on change |
| `npm run build` | Build once to `dist/`                        |
| `npm run start` | Run the built server (`dist/index.mjs`)      |

## Project layout

```text
src/
  schema.ts   # Outer schema definition (`post` table + the file tables)
  index.ts    # Server entry — schema, files, resource + procedure, srvx listener
```

`src/index.ts` mounts `.resource("post")` (auto CRUD) plus one custom `.procedure("post.count", ...)`, and enables `.openapi()`. Add `.auth(...)`, `.middleware(...)`, and more `.procedure()` calls the same way — see [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md) for the full API.

## File uploads

Two calls give you the whole upload surface — `schema().files()` for the tables, `.files()` on the chain for the routes:

```ts
new Outer({
  db: pglite(),
  storage: fromUnstorage(createStorage({ driver: fsLite({ base: ".outer/files" }) })),
})
  .schema(v1_0_0) // schema("1.0.0").auth().files({ attachTo: ["post"] })
  .auth({ ... })
  .files({ maxBytes: 10 * 1024 * 1024 })
```

That registers:

| Endpoint                                                 | What it does                                         |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `client.file.upload({ file, attach? })`                  | Stores the bytes, optionally attaching to a post     |
| `client.file.list({ attachedTo? })`                      | The signed-in user's files, filterable by attachment |
| `client.file.get({ id })` / `client.file.delete({ id })` | Read / remove one file                               |
| `client.file.attach(...)` / `client.file.detach(...)`    | Link an existing file to a post                      |
| `GET /files/:id`                                         | Serves the bytes to their owner                      |

Uploads go over the normal typed client — pass a `File` and oRPC switches the request to `multipart/form-data` on its own:

```ts
const { url } = await client.file.upload({ file: input.files[0] });
```

Files are **private by default**: only the uploader can read or delete them, and the download route returns `404` to everyone else. Pass `permissions: { get: "public" }` to `.files()` for avatars and other world-readable assets.

Bytes live under `.outer/files` via [unstorage](https://unstorage.unjs.io)'s `fs-lite` driver; the `file` table holds only metadata and ownership. Swapping that driver for `s3` — or passing `fromS3(...)` instead of `fromUnstorage(...)` — is the only change needed to move uploads to object storage in production.

Looking to deploy to Cloudflare Workers instead? See [`templates/cloudflare`](../cloudflare) — same schema shape, backed by a Durable Object instead of PGlite.

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [srvx docs](https://srvx.h3.dev)
- [tsdown docs](https://tsdown.dev)

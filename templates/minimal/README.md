# Outer + srvx

The smallest possible Outer server: no frontend, no framework — just `new Outer(...).build()` behind [srvx](https://srvx.h3.dev), a tiny universal fetch-based HTTP server, bundled with [tsdown](https://tsdown.dev).

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
  schema.ts   # Outer schema definition (one `post` table)
  index.ts    # Server entry — schema, resource + procedure, srvx listener
```

`src/index.ts` mounts `.resource("post")` (auto CRUD) plus one custom `.procedure("post.count", ...)`, and enables `.openapi()`. Add `.auth(...)`, `.middleware(...)`, and more `.procedure()` calls the same way — see [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md) for the full API.

Looking to deploy to Cloudflare Workers instead? See [`templates/cloudflare`](../cloudflare) — same schema shape, backed by a Durable Object instead of PGlite.

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [srvx docs](https://srvx.h3.dev)
- [tsdown docs](https://tsdown.dev)

# Outer

Outer is an alternative to Supabase, PocketBase, and Firebase where you own 100% of the solution and data. It's a batteries-included TypeScript backend framework built on [PGlite](https://pglite.dev), [Kysely](https://kysely.dev), [oRPC](https://orpc.unnoq.com), and [Better Auth](https://better-auth.com), exposed through a fluent builder chain that produces a single fetch-compatible HTTP handler — deploy it to a VPS, Coolify, Vercel, Cloudflare Workers, or alongside any frontend app.

## Quick start

```ts
import { Outer, schema } from "@outerjs/server";
import { serve } from "srvx";

const v1_0 = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    body: t.text().nullable(),
    userId: t.text(),
  }))
  .build();

const outer = new Outer({ name: "My API", baseUrl: "http://localhost:3000" })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .resource("post", {
    permissions: { create: "authenticated", update: "owner", delete: "owner" },
    ownerColumn: "userId",
  })
  .procedure("hello", (base) => base.handler(() => "world"))
  .build();

await outer.migrator.migrateToLatest();
serve({ fetch: (req) => outer.handle(req) });
```

This gets you, with zero extra setup:

- A local Postgres (PGlite) database, schema-driven migrations, and a typed `context.db` (Kysely + a read-focused ORM layer)
- Auth (sign-up/sign-in/sessions) via Better Auth, mounted at `/api/auth/**`
- Auto-generated CRUD procedures per table via `.resource()`, with per-action permissions (`public` / `authenticated` / `admin` / `owner` / custom function)
- Type-safe RPC procedures via oRPC, served at `/rpc/**`, plus a generated OpenAPI spec at `/openapi.json`
- Realtime streaming (SSE) via oRPC event iterators — no extra infrastructure

Pair it with `@outerjs/sdk` on the client for a type-safe RPC + auth client in one call:

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

export const client = createClient<InferRouter<typeof outer>>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();
```

See [SPEC.md](./SPEC.md) for the full API reference.

## Repo layout

This is a Bun workspace monorepo:

| Path                   | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `packages/server`      | The `@outerjs/server` package — Outer's core                               |
| `packages/sdk`         | The `@outerjs/sdk` package — type-safe client (oRPC + Better Auth)         |
| `templates/nitro-ilha` | Example app: Outer mounted as a Nitro server entry inside an ilha frontend |

## Development

```bash
bun install
bun run build   # builds every package
bun run test    # runs every package's test suite
bun run lint    # oxlint
bun run fmt     # oxfmt
```

## License

MIT

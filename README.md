# Outer

Outer is an alternative to Supabase, PocketBase, and Firebase where you own 100% of the solution and data. It's a batteries-included TypeScript backend framework built on [Kysely](https://kysely.dev), [oRPC](https://orpc.unnoq.com), and [Better Auth](https://better-auth.com), exposed through a fluent builder chain that produces a single fetch-compatible HTTP handler. [PGlite](https://pglite.dev) (real embedded Postgres, zero external infra) is the recommended default database for persistent-hosting deploys (VPS, Coolify) — see `templates/minimal`. Serverless/edge platforms are supported via any Kysely dialect: see `templates/cloudflare` (Durable Objects) and `templates/vercel-neon` (Neon Postgres).

## Quick start

```ts
import { Outer, schema } from "@outerjs/server";
import { pgliteDb } from "@outerjs/server/pglite";
import { serve } from "srvx";

const v1_0 = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    body: t.text().nullable(),
    userId: t.text(),
  }))
  .build();

const outer = new Outer({ name: "My API", baseUrl: "http://localhost:3000", db: pgliteDb() })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .openapi()
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

- A local **Postgres (PGlite) database**, schema-driven migrations, and a typed `context.db` (Kysely + a read-focused ORM layer)
- **Auth** (sign-up/sign-in/sessions) via Better Auth, mounted at `/api/auth/**`
- Auto-generated **CRUD procedures** per table via `.resource()`, with per-action permissions (`public` / `authenticated` / `admin` / `owner` / custom function)
- **Type-safe RPC** procedures via oRPC, served at `/rpc/**`, plus an opt-in OpenAPI spec at `/openapi.json` (`.openapi()`)
- **Realtime streaming** (SSE) via oRPC event iterators — no extra infrastructure

Pair it with `@outerjs/sdk` on the client for a type-safe RPC + auth client in one call:

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

type Router = InferRouter<typeof outer>;

export const client = createClient<Router>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();
```

See [SPEC.md](./SPEC.md) for the full API reference.

## Repo layout

This is a Bun workspace monorepo:

| Path                    | Description                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/server`       | The `@outerjs/server` package — Outer's core                                                         |
| `packages/sdk`          | The `@outerjs/sdk` package — type-safe client (oRPC + Better Auth)                                   |
| `templates/ilha`        | Example app: Outer mounted as a Nitro server entry inside an ilha frontend                           |
| `templates/minimal`     | Minimal example: bare Outer server behind srvx, built with tsdown                                    |
| `templates/cloudflare`  | Outer on Cloudflare Workers, backed by a Durable Object (`kysely-durable-objects`) instead of PGlite |
| `templates/vercel-neon` | Outer on Vercel serverless functions, backed by Neon Postgres (`kysely-neon`) instead of PGlite      |

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

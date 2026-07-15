# Outer

**Own your backend.** Outer is an open-source alternative to Supabase, PocketBase, and Firebase where you own 100% of the solution and the data — no hosted control plane, no per-project pricing, nothing leaving your box. One TypeScript builder chain gives you a real Postgres database, auth, typed RPC, auto-generated CRUD with row-level permissions, migrations, realtime, and OpenAPI — compiled into a single fetch-compatible handler you can deploy to a $5 VPS, Coolify, Cloudflare Workers, or Vercel.

Built on proven pieces — [Kysely](https://kysely.dev), [oRPC](https://orpc.unnoq.com), [Better Auth](https://better-auth.com), and [PGlite](https://pglite.dev) — instead of reinventing them.

## Quick start

```bash
npx giget@latest gh:ilhajs/outer/templates/minimal my-outer-app
```

Or from scratch — this is a complete backend:

```ts
import { Outer, schema } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { serve } from "srvx";

const v1_0 = schema("1.0.0")
  .auth() // Better Auth tables (user, session, account, verification) + admin plugin fields
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    body: t.text().nullable(),
    userId: t.text().references("user", "id"),
  }))
  .build();

const outer = new Outer({ name: "My API", baseUrl: "http://localhost:3000", db: pglite() })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .openapi()
  .admin()
  .resource("post", {
    permissions: { create: "authenticated", update: "owner", delete: "owner" },
    ownerColumn: "userId",
  })
  .procedure("hello", (base) => base.handler(() => "world"))
  .build();

await outer.migrator.migrateToLatest();
serve({ fetch: (req) => outer.handle(req) });
```

With zero extra setup, that's:

- A local **Postgres database** ([PGlite](https://pglite.dev) — real embedded Postgres, not SQLite pretending), schema-driven **migrations**, and a typed `context.db` (Kysely + a Prisma-style read API)
- **Auth** — sign-up, sign-in, sessions, social providers — via Better Auth at `/api/auth/**`, with the auth tables registered in one call (`schema().auth()`)
- Auto-generated **CRUD procedures** per table via `.resource()`, with per-action permissions: `public` / `authenticated` / `admin` / `owner` / your own function
- **Type-safe RPC** at `/rpc/**`, plus opt-in **OpenAPI** (`/openapi.json`) with a spec-accurate plain-JSON surface at `/rest/**`
- An **admin API** via `.admin()` — schema introspection, migration status, and table CRUD under `/rpc/_admin/**`, guarded by the admin role, ready for a dashboard to consume
- **Realtime streaming** (SSE) via oRPC event iterators — no extra infrastructure

Serving a browser frontend from another origin? Pass `cors` to the constructor: `new Outer({ cors: { origins: [...] } })` — it covers `/rpc/**`, `/api/auth/**`, and the admin API, and feeds Better Auth's `trustedOrigins`.

And because `outer.handle(request)` is a plain Fetch handler, it mounts unchanged into Bun, Node, srvx, Nitro, Hono, H3, or Next.js API Routes.

## End-to-end types

Pair it with `@outerjs/sdk` on the client for a fully typed RPC + auth client in one call — every `.procedure()`'s input and output flows to your frontend:

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

await client.hello(); // "world" — typed
```

## Deploy anywhere

The `pglite()` default writes to local disk, which makes persistent hosts (VPS, Coolify, any long-lived process) a zero-infra deploy. On serverless/edge, swap in any Kysely dialect — the templates show both paths:

| Template      | Stack                                                                                           | Command                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `minimal`     | Bare Outer server behind [srvx](https://srvx.h3.dev)                                            | `npx giget@latest gh:ilhajs/outer/templates/minimal my-app`     |
| `ilha`        | Full-stack: Outer in a [Nitro](https://nitro.build) entry + [Ilha](https://ilha.build) frontend | `npx giget@latest gh:ilhajs/outer/templates/ilha my-app`        |
| `cloudflare`  | Cloudflare Workers, backed by a Durable Object's SQLite storage                                 | `npx giget@latest gh:ilhajs/outer/templates/cloudflare my-app`  |
| `vercel-neon` | Vercel serverless functions, backed by [Neon](https://neon.tech) Postgres                       | `npx giget@latest gh:ilhajs/outer/templates/vercel-neon my-app` |

Heavy or platform-specific dependencies are optional peers, so a Workers deploy never downloads PGlite's WASM and a server that skips `.openapi()` never installs the OpenAPI toolchain.

## Documentation

- [SPEC.md](./SPEC.md) — the full API reference: builder chain, schema and migrations, resource permissions, the Sola query API, realtime, type extraction
- Guides on the website: getting started and deployment (`apps/website`)

## Repo layout

This is a Bun workspace monorepo:

| Path              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `packages/server` | `@outerjs/server` — Outer's core                       |
| `packages/sdk`    | `@outerjs/sdk` — type-safe client (oRPC + Better Auth) |
| `templates/*`     | Deployable starters (see table above)                  |
| `apps/website`    | Documentation website                                  |

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

<div align="center">

# Outer

### The open-source backend for the agentic internet.

**Define a procedure once — serve it as typed RPC, REST, an OpenAPI spec, and an MCP tool your agents can call.** Real Postgres with pgvector, running on the same box as your app. No hosted control plane, no per-project pricing, nothing leaving your machine.

`Self-hosted` · `MIT licensed` · `Alpha`

</div>

Outer is an open-source alternative to Supabase, PocketBase, and Firebase where **you own 100% of the solution and the data**. One TypeScript builder chain gives you a Postgres database, auth, typed RPC, auto-generated CRUD with row-level permissions, file uploads, migrations, realtime, OpenAPI, and an MCP server — compiled into a single fetch-compatible handler you can drop on a $5 VPS, Coolify, Cloudflare Workers, or Vercel.

It's built on pieces you already trust — [Kysely](https://kysely.dev), [oRPC](https://orpc.unnoq.com), [Better Auth](https://better-auth.com), and [PGlite](https://pglite.dev) — instead of reinventing them. `.outer/pglite` is a folder you own; there is no dashboard between you and your data.

```bash
npx giget@latest gh:ilhajs/outer/templates/minimal my-outer-app
```

## A complete backend, from one file

```ts
import { Outer } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { schema } from "@outerjs/server/schema";
import { fromSchema } from "@outerjs/server/secrets";
import { fromUnstorage } from "@outerjs/server/storage";
import { serve } from "srvx";
import { createStorage } from "unstorage";
import fsLite from "unstorage/drivers/fs-lite";
import { z } from "zod";

// Validate env once; read typed values via `context.secrets` anywhere — no more `process.env.X!`
const secrets = fromSchema(
  z.object({
    AUTH_SECRET: z.string(),
    BASE_URL: z.string().default("http://localhost:3000"),
  }),
  process.env,
);

// Versioned schema — drives migrations, query types, and endpoint validation
const v1_0 = schema("1.0.0")
  .auth() // Better Auth tables (user, session, account, verification) + admin fields
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    body: t.text().nullable(),
    userId: t.text().references("user", "id"),
  }))
  .files({ attachTo: ["post"] }) // `file` metadata table + a `post_file` pivot
  .build();

const outer = new Outer({
  name: "My API",
  baseUrl: secrets.get("BASE_URL"),
  db: pglite(), // embedded Postgres + pgvector; swap for any Kysely Dialect
  cors: { origins: ["https://app.example.com"], credentials: true },
  storage: fromUnstorage(createStorage({ driver: fsLite({ base: ".outer/files" }) })),
  secrets, // surfaced as context.secrets
  rateLimit: { max: 100, windowMs: 60_000 }, // per-caller on /rpc + /rest
})
  .schema(v1_0)
  .auth({ secret: secrets.require("AUTH_SECRET") }) // sign-up, sessions, social — /api/auth/**
  .openapi() // GET /openapi.json + a plain-JSON REST surface at /rest/**
  .admin() // schema introspection + table CRUD at /rpc/_admin/**, admin-gated
  .files() // upload / download / attach + GET /files/:id, private to the uploader
  .resource("post", {
    // six typed CRUD endpoints with row-level permissions
    permissions: { list: "public", create: "authenticated", update: "owner", delete: "owner" },
    ownerColumn: "userId", // auto-filled on create, enforced on owner checks
  })
  .procedure("post.search", (base) =>
    // your own typed RPC — Zod-validated input, Prisma-style reads on context.db
    base
      .input(z.object({ q: z.string() }))
      .handler(({ input, context }) =>
        context.db.query.post.findMany({ where: { title: { contains: input.q } }, take: 20 }),
      ),
  )
  .build();

await outer.migrator.migrateToLatest();
serve({ fetch: (req) => outer.handle(req) }); // outer.handle is a plain Fetch handler
```

That's validated env secrets, auth, six CRUD endpoints for `post` with ownership enforced, file uploads, an admin API, an OpenAPI spec, per-caller rate limiting, a custom search procedure over the Prisma-style query API, and versioned migrations — backed by embedded Postgres that writes to local disk, with **zero infrastructure to run**.

## Why developers pick Outer

|                 | A hosted BaaS                                                               | Outer                                                                                                       |
| :-------------- | :-------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Your data**   | Lives in someone else's database, behind their dashboard and their billing. | Lives in your Postgres, on your infra. `.outer/pglite` is a folder you own.                                 |
| **Your auth**   | A black box you configure through a settings UI.                            | [Better Auth](https://better-auth.com) — real code you read, extend, and call directly from `context.auth`. |
| **Your client** | Generated after the fact, and quietly drifts from your schema.              | Inferred straight from your server. If it compiles, it matches.                                             |
| **Scaling**     | Means picking a new pricing plan past the free tier.                        | Means giving the box you already pay for more CPU and RAM.                                                  |

## One router, four surfaces

Define a procedure once. Outer serves it four ways, with no second definition to keep in sync:

- **Typed RPC** at `/rpc/**` — the wire protocol `@outerjs/sdk` speaks, end to end.
- **REST + OpenAPI** — a spec-accurate plain-JSON surface at `/rest/**`, plus `GET /openapi.json`.
- **MCP tools** at `/mcp` — `.mcp()` hands agents your _shipped business logic_, not raw database access, inheriting the exact permissions your app already enforces. (`post.search` becomes the `post_search` tool.)

Add `.admin()` for a self-describing admin API — schema introspection, migration status, and table CRUD — ready for a dashboard to drive.

## What one chain gives you

With zero extra setup:

- **Real Postgres, embedded** — [PGlite](https://pglite.dev) is actual Postgres in your process (not SQLite pretending), with **pgvector bundled in** for vector search on a $4 box. Prefer Neon, Durable Objects, or network Postgres? Pass any Kysely `Dialect` and the whole chain is unchanged.
- **A typed `context.db`** — Kysely for writes, a Prisma-style read API (`findMany`, `where` operators, `include`, cursor `paginate`) via `context.db.query`, and `context.db.transact()` for transactions that span both.
- **Auto-generated CRUD** per table via `.resource()`, with per-action permissions — `public` / `authenticated` / `admin` / `owner` / your own function — plus field-level write control (`writable` / `readonly`) so a client can never spoof a server-managed column.
- **File uploads** via `.files()` — typed `file.upload` and a `GET /files/:id` route, private to the uploader by default (a 404, never a 403), bytes in unstorage / S3·R2 / Vercel Blob and only metadata in Postgres. Downloads are hardened against stored XSS out of the box.
- **Realtime, no broker** — an async generator in a `.procedure()` streams over SSE with resumable delivery, and `context.db.query.<table>.live()` turns any read into a reactive stream on PGlite.
- **Schema-driven migrations** — versioned, diffed, and applied from your `schema()`.

## Schema to SSR, no HTTP hop

`outer.client()` calls your procedures in-process during server rendering — same types, no serialization, no localhost round-trip:

```ts
// In a Server Component / server function, in the same process as Outer:
const api = outer.client(() => headers()); // sees the caller's session, runs permission checks
const posts = await api.post.list();
```

On the client, `@outerjs/sdk` gives you a fully typed RPC + auth client in one call — every `.procedure()`'s input and output flows to your frontend, with **no codegen step and no SDK to regenerate**:

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

export const client = createClient<InferRouter<typeof outer>>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();

await client.hello(); // "world" — typed. Rename it on the server and this turns red.
```

Because `outer.handle(request)` is a plain `(Request) => Promise<Response>`, it mounts unchanged into Bun, Node, srvx, Nitro, Hono, H3, or Next.js API Routes.

## Deploy anywhere

The `pglite()` default writes to local disk, so any persistent host (VPS, Coolify, a long-lived process) is a zero-infra deploy. On serverless/edge, swap in a Kysely dialect — the templates show both paths, and heavy or platform-specific pieces are optional peers, so a Workers deploy never downloads PGlite's WASM.

| Template      | Stack                                                                                           | Scaffold                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `minimal`     | Bare Outer server behind [srvx](https://srvx.h3.dev)                                            | `npx giget@latest gh:ilhajs/outer/templates/minimal my-app`     |
| `ilha`        | Full-stack: Outer in a [Nitro](https://nitro.build) entry + [Ilha](https://ilha.build) frontend | `npx giget@latest gh:ilhajs/outer/templates/ilha my-app`        |
| `cloudflare`  | Cloudflare Workers — Durable Object SQLite for data, R2 for uploads                             | `npx giget@latest gh:ilhajs/outer/templates/cloudflare my-app`  |
| `vercel-neon` | Vercel functions — [Neon](https://neon.tech) Postgres for data, Vercel Blob for uploads         | `npx giget@latest gh:ilhajs/outer/templates/vercel-neon my-app` |

## Documentation

- [SPEC.md](./SPEC.md) — the full API reference: builder chain, schema and migrations, resource permissions, the Sola query API, realtime, MCP, type extraction.
- Guides and API reference on the website (`apps/website`).

## Repo layout

A Bun workspace monorepo:

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

MIT — no telemetry, nothing phoning home. The whole thing runs on hardware you already pay for.

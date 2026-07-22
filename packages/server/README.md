# @outerjs/server

**Own your backend.** Outer is an open-source alternative to Supabase, PocketBase, and Firebase where you own 100% of the solution and the data — one TypeScript builder chain that gives you real Postgres, auth, typed RPC, auto-generated CRUD, file uploads, migrations, OpenAPI, and an MCP server, compiled into a single fetch-compatible handler you can deploy anywhere.

**Define a procedure once — serve it as typed RPC, REST, an OpenAPI spec, and an MCP tool your agents can call.**

```ts
import { Outer, schema } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";

const v1_0 = schema("1.0.0")
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().references("user", "id"),
  }))
  .build();

const outer = new Outer({ name: "My API", db: pglite() })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .resource("post", {
    permissions: { list: "public", create: "authenticated", update: "owner", delete: "owner" },
    ownerColumn: "userId",
  })
  .procedure("post.count", (base) =>
    base.handler(async ({ context }) => context.db.query.post.count()),
  )
  .build();

await outer.migrator.migrateToLatest();
export default { fetch: (req: Request) => outer.handle(req) };
```

That's a complete backend: email/password + social auth at `/api/auth/**`, six typed CRUD endpoints for `post` with row-level ownership enforced, a custom RPC procedure at `POST /rpc/post/count`, and versioned migrations — backed by an embedded Postgres that writes to local disk, with zero infrastructure to run.

## Why Outer

- **You own everything.** No hosted control plane, no per-project pricing, no data leaving your box. `git clone`, deploy to a $5 VPS or Coolify, done.
- **Real Postgres, zero infra.** The [PGlite](https://pglite.dev) default is actual Postgres running embedded in your process — not SQLite pretending — with **pgvector bundled in**. Prefer managed Postgres, Neon, or Cloudflare Durable Objects? Pass any [Kysely](https://kysely.dev) dialect instead and the whole chain is unchanged.
- **One router, four surfaces.** Every procedure is served as typed RPC, plain-JSON REST, an OpenAPI spec, and — with `.mcp()` — an MCP tool, from a single definition with nothing to keep in sync.
- **Batteries included, opinions optional.** Auth ([Better Auth](https://better-auth.com)), typed RPC ([oRPC](https://orpc.unnoq.com)), validation ([Zod](https://zod.dev)), a Prisma-style query API, declarative CRUD permissions with field-level write control — each behind an explicit builder call, so you only carry what you enable.
- **End-to-end types.** `InferRouter<typeof outer>` gives your frontend a fully typed client for every `.procedure()` — inputs, outputs, and errors — with no codegen step.
- **Deploys as a fetch handler.** `outer.handle(request)` is a plain `(Request) => Promise<Response>`, so it mounts into Bun, Node, srvx, Nitro, Hono, H3, or Next.js API Routes unchanged.

## What you get from one chain

| Call             | What it adds                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.schema(v)`     | Versioned, typed schema — drives migrations, query types, and generated endpoint validation                                             |
| `.auth(config)`  | Better Auth mounted at `/api/auth/**` — sessions, social providers, plugins; resolves `context.user` once per request                   |
| `.resource(t)`   | `list` / `get` / `create` / `createMany` / `update` / `delete` with filters, relation `include`, permissions, and `writable`/`readonly` |
| `.procedure(n)`  | Custom typed RPC at `POST /rpc/<name>` with Zod-validated input/output                                                                  |
| `.middleware(m)` | Context enrichment shared by every procedure after it                                                                                   |
| `.route(...)`    | Raw escape hatch for webhooks and custom REST                                                                                           |
| `.files(...)`    | `file.upload` / `list` / `get` / `delete` / `attach` / `detach` + `GET /files/:id`, private by default, bytes in any object store       |
| `.openapi()`     | `GET /openapi.json` + a spec-accurate plain-JSON surface at `/rest/**`                                                                  |
| `.mcp()`         | The same router as an MCP server over Streamable HTTP at `/mcp`, so agents call your procedures as tools (opt-in per procedure)         |
| `.admin()`       | Admin API under `/rpc/_admin/**` — schema introspection, migration status, table CRUD (requires the admin role)                         |

CORS is configured on the constructor — `new Outer({ cors: { origins } })` — and applies to `/rpc/**`, `/api/auth/**`, and the admin API; the origins are also folded into Better Auth's `trustedOrigins`.

Inside every handler, `context.db` is a typed Kysely instance with extras: `context.db.query` for Prisma-style reads (`findMany`, `where` operators, `include`, cursor `paginate`, reactive `live()`) and `context.db.transact(fn)` for transactions that span both APIs.

## Install

```bash
bun add @outerjs/server
bun add @electric-sql/pglite @electric-sql/pglite-pgvector # optional — only for the embedded pglite() default
```

Or start from a template:

```bash
npx giget@latest gh:ilhajs/outer/templates/minimal my-outer-app
```

Heavy or platform-specific pieces are optional peer dependencies, kept out of your install until you opt in: `@electric-sql/pglite` (only for `pglite()`), `@orpc/openapi` + `@orpc/zod` (only for `.openapi()`), and `orpc-mcp` + `@orpc/zod` (only for `.mcp()`).

## Documentation

The full API reference lives in [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md) — schema and migrations, resource permissions and field-level write control, the Sola query API, realtime event streams, MCP, type extraction, and deployment guides.

## License

MIT

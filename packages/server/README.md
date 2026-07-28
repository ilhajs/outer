# @outerjs/server

**Own your backend.** Outer is an open-source alternative to Supabase, PocketBase, and Firebase where you own 100% of the solution and the data — one TypeScript builder chain that gives you real Postgres, auth, typed RPC, auto-generated CRUD, file uploads, migrations, OpenAPI, and an MCP server, compiled into a single fetch-compatible handler you can deploy anywhere.

**Define a procedure once — serve it as typed RPC, REST, an OpenAPI spec, and an MCP tool your agents can call.**

```ts
import { Outer } from "@outerjs/server";
import { schema } from "@outerjs/server/schema";
import { pglite } from "@outerjs/server/pglite";

const v1_0 = schema("1.0.0")
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().references("user", "id"),
  }))
  .relation("user", (rel) => rel.hasMany("post", { from: "id", to: "userId" }))
  .relation("post", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

const outer = await new Outer({ name: "My API", db: pglite() })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .resource("post", {
    permissions: { list: "public", create: "authenticated", update: "owner", delete: "owner" },
    ownerColumn: "userId",
  })
  .procedure("post.count", (base) =>
    base.handler(async ({ context }) => context.db.query.post.count()),
  )
  .start();

export default { fetch: (req: Request) => outer.handle(req) };
```

That's a complete backend: email/password + social auth at `/api/auth/**`, typed CRUD for `post` with row-level ownership, a custom RPC procedure at `POST /rpc/post/count`, and versioned migrations — backed by embedded Postgres on local disk.

## Why Outer

- **You own everything.** No hosted control plane, no per-project pricing, no data leaving your box.
- **Real Postgres, zero infra.** [PGlite](https://pglite.dev) by default, with pgvector available. Swap any [Kysely](https://kysely.dev) dialect when you need managed Postgres.
- **One router, four surfaces.** Typed RPC, plain-JSON REST, OpenAPI, and MCP from a single procedure definition.
- **End-to-end types.** `InferRouter<typeof outer>` types [`@outerjs/sdk`](https://www.npmjs.com/package/@outerjs/sdk) with no codegen.
- **Deploys as a fetch handler.** `outer.handle(request)` mounts into Bun, Node, srvx, Nitro, Hono, H3, or Next.js API Routes.

## Install

```bash
bun add @outerjs/server
bun add @electric-sql/pglite @electric-sql/pglite-pgvector # optional — only for pglite()
```

Or start from a template:

```bash
npx giget@latest gh:ilhajs/outer/templates/minimal my-outer-app
```

Optional peers: `@orpc/openapi` + `@orpc/zod` for `.openapi()`, `orpc-mcp` + `@orpc/zod` for `.mcp()`.

## Documentation

Start on the website — not only this README:

| Guide                         | URL                                               |
| ----------------------------- | ------------------------------------------------- |
| Introduction                  | <https://outer.now/getting-started/introduction>  |
| Client (`@outerjs/sdk` + SSR) | <https://outer.now/getting-started/client>        |
| `new Outer()`                 | <https://outer.now/outer/server>                  |
| API reference                 | <https://outer.now/getting-started/api-reference> |
| Schema                        | <https://outer.now/schema/defining-schema>        |
| CORS, rate limit, health      | <https://outer.now/outer/server#cors>             |
| Deployment                    | <https://outer.now/outer/deployment>              |

The machine-oriented source of truth is still [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md).

## License

MIT

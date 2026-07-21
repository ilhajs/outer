# Outer — Specification

Outer is a batteries-included TypeScript backend framework built on Kysely, oRPC, and Better Auth, with [PGlite](https://pglite.dev) as the recommended zero-infra default database. It exposes a builder-chain API that produces a fetch-compatible HTTP handler.

---

## Builder chain

```ts
import { pglite } from "@outerjs/server/pglite";

const server = new Outer({ name: "My API", baseUrl: "http://localhost:3000", db: pglite() })
  .schema(v1_0)
  .schema(v1_1)        // each call adds a migration step and updates the DB type
  .auth({ secret: process.env.AUTH_SECRET! })
  .middleware(...)
  .procedure("user.me", (base) => base.handler(...))
  .build();

await server.migrator.migrateToLatest();
serve({ fetch: (req) => server.handle(req) });
```

Order matters: `.schema()` → `.middleware()` → `.procedure()` → `.build()`. `.auth()`, `.openapi()`, `.mcp()`, `.admin()`, and `.files()` can appear anywhere in the chain.

---

## `new Outer(params)`

| Param        | Type                     | Default         | Description                                                                                                   |
| ------------ | ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`       | `string`                 | `"Outer API"`   | API title in OpenAPI spec                                                                                     |
| `baseUrl`    | `string`                 | —               | Default `baseURL` passed to Better Auth when `.auth()` is called (override per-call via `.auth({ baseURL })`) |
| `db.dialect` | `Dialect`                | —               | Required. A Kysely `Dialect` — see below                                                                      |
| `db.kind`    | `"postgres" \| "sqlite"` | —               | Required. Drives DDL generation, Better Auth's schema, and DB error mapping — must match `db.dialect`         |
| `db.live`    | `LiveProvider`           | —               | Change feed backing [live queries](#live-queries). `pglite()` supplies one; without it `live*()` throws       |
| `cors`       | `CorsConfig`             | —               | Cross-origin browser callers allowed to reach `/rpc/**`, `/api/auth/**`, and the admin API — see CORS below   |
| `storage`    | `OuterStorage`           | —               | Object store for file bytes — surfaced as `context.storage` and used by `.files()`                            |
| `onError`    | `(error, info) => void`  | `console.error` | Called for unexpected failures (never for deliberate `ORPCError` responses) — route to your logger or Sentry  |
| `health`     | `boolean \| { path }`    | `true`          | Mounts `GET /health` with a `select 1` probe. `false` omits it; a `.route()` on the same path wins            |
| `rateLimit`  | `RateLimitConfig`        | —               | Per-caller limit on `/rpc/**` and `/rest/**`. Off by default; `/api/auth/**` is excluded                      |

### `onError`

```ts
new Outer({ db, onError: (error, { source }) => logger.error({ err: error, source }) });
```

`source` is `"rpc" | "rest" | "route"`. Deliberate `ORPCError` responses (400/401/403/404/409, …) are application behaviour, not failures, so they are never reported. Without a hook, unexpected errors go to `console.error`; pass `() => {}` to silence them entirely.

### `health`

`GET /health` returns `200 {"status":"ok","database":"up"}`, or `503 {"status":"error","database":"down"}` when the `select 1` probe fails — point Coolify/Docker/uptime checks at it. It is not rate limited.

### `rateLimit`

```ts
new Outer({ db, rateLimit: { max: 100, windowMs: 60_000 } });
```

| Field      | Default                  | Description                                             |
| ---------- | ------------------------ | ------------------------------------------------------- |
| `max`      | —                        | Requests allowed per window, per key                    |
| `windowMs` | —                        | Window length in ms (fixed window, not sliding)         |
| `key`      | user id, else client IP  | `(event, user) => string` — identifies the caller       |
| `skip`     | —                        | `(event) => boolean` to bypass the limit                |
| `store`    | `memoryRateLimitStore()` | Swap in Redis/Upstash to share counters across replicas |

Over-limit requests get `429` with `Retry-After` and `RateLimit-*` headers. **The default store is in-process**, so each replica counts separately — behind a load balancer the effective limit is `max × replicas`. The default key falls back to `x-forwarded-for` / `x-real-ip`; if your proxy strips both, every caller shares one bucket, so pass `key` explicitly.

Implement `RateLimitStore` for a shared backend:

```ts
type RateLimitStore = {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  dispose?(): void;
};
```

`db` is required — `@outerjs/server`'s core has no database opinion baked in. For the zero-infra default (embedded [PGlite](https://pglite.dev), real Postgres, writes to local disk, no external infra to run), import the helper from the `/pglite` subpath rather than the framework's dependency tree pulling it in unconditionally:

```ts
import { Outer } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";

new Outer({ db: pglite() }); // or pglite({ dataDir: "..." }), defaults to <cwd>/.outer/pglite
```

This is the path to reach for first; it's what makes Outer deployable to a VPS/Coolify box with nothing else to provision. Splitting it into a subpath keeps PGlite's WASM out of deploy bundles for platforms where it's dead weight (Cloudflare Workers, Vercel Functions) — see `templates/cloudflare` and `templates/vercel-neon`.

`@electric-sql/pglite` and `@electric-sql/pglite-pgvector` are **optional peer dependencies**: apps that use `pglite()` must install them themselves (`bun add @electric-sql/pglite @electric-sql/pglite-pgvector`), and apps on other dialects (Durable Objects, Neon, network Postgres) never download the WASM at all.

Two extensions are loaded into the PGlite instance by default, so lower-level Postgres features are available without constructing your own client:

- **vector** (`@electric-sql/pglite-pgvector`) — pgvector. `CREATE EXTENSION IF NOT EXISTS vector` is issued at construction, queued ahead of any dialect query, so `vector` columns and the distance operators (`<->`, `<=>`, `<#>`) are usable from the first migration onward. Reachable through ordinary SQL — declare the column with `sql` in a migration or `context.db` query; the schema builder has no `t.vector()` column type yet.

  ```ts
  await context.db
    .selectFrom("doc")
    .select("id")
    .orderBy(sql`embedding <-> ${sql.lit("[1,2,3]")}`)
    .limit(5)
    .execute();
  ```

- **live** (`@electric-sql/pglite/live`) — reactive queries. Surfaced as [`context.db.query.<table>.live()`](#live-queries); no need to touch the extension directly.

`pglite()` returns `{ dialect, kind, live, client }`. `live` is the `LiveProvider` Sola uses; `client` is the PGlite instance itself, for anything neither the query builder nor Sola covers (Kysely's `PGliteDialect` keeps its own reference private, so this is the only handle).

### Custom dialects

For platforms without a persistent filesystem (Vercel Functions, Cloudflare Workers), or to point at an existing database, pass any [Kysely `Dialect`](https://kysely.dev/docs/dialects) directly:

```ts
import { D1Dialect } from "kysely-d1"; // or PostgresDialect, MysqlDialect, kysely-durable-objects, etc.

new Outer({
  db: { dialect: new D1Dialect({ database: env.DB }), kind: "sqlite" },
});
```

`kind` tells Outer which SQL dialect family to generate DDL for (column types like `serial`/`jsonb`/`uuid` don't exist in SQLite, so they're remapped) and which constraint-error codes to recognize when turning DB errors into `CONFLICT`/`BAD_REQUEST` responses. Currently supported: `"postgres"` (PGlite, or any network Postgres via `PostgresDialect`) and `"sqlite"` (Cloudflare D1, Durable Objects via `kysely-durable-objects`, libSQL/Turso, etc.). Kysely also ships `mysql`/`mssql` dialects, and Better Auth supports them — but Outer doesn't generate correct DDL for them yet, so `kind` is deliberately typed to just the two verified options. Widening this is mechanical (one more entry in the internal type/error-code maps per dialect family) if you need it — contributions welcome.

---

## `.openapi(config?)`

Toggles `GET /openapi.json` **and** the plain-JSON REST surface at `/rest/**`. Not mounted unless this is called — calling it with no args enables it. Must be called before `.build()`. Can appear anywhere in the chain.

The `/rpc/**` handler speaks oRPC's own wire protocol, which generic OpenAPI clients can't use — so when `.openapi()` is enabled, the same router is also served through oRPC's `OpenAPIHandler` under `/rest/**`, matching the generated spec exactly (the spec's `servers[0].url` points at `<baseUrl>/rest`).

`@orpc/openapi` and `@orpc/zod` are **optional peer dependencies** — they're loaded lazily on the first request to `/openapi.json` or `/rest/**`, so apps that never call `.openapi()` don't need them installed. If `.openapi()` is enabled but they're missing, those routes fail with an error telling you to `bun add @orpc/openapi @orpc/zod`.

| Option    | Type      | Default | Description                                   |
| --------- | --------- | ------- | --------------------------------------------- |
| `enabled` | `boolean` | `true`  | Whether to mount `/openapi.json` + `/rest/**` |

```ts
.openapi() // always enabled
.openapi({ enabled: import.meta.env.DEV }) // enable on dev/staging only, keep it off in prod
```

---

## `.mcp(config?)`

Serves the same router as an [MCP](https://modelcontextprotocol.io) server over the Streamable HTTP transport, so Claude, IDEs, and agents can call your procedures as tools. Requires the optional peers `orpc-mcp` and `@orpc/zod`.

```ts
import { mcp, Outer } from "@outerjs/server";

new Outer({ db: pglite() })
  .schema(v1_0)
  .procedure(
    "post.search",
    (base) =>
      base
        .meta(mcp.tool({ description: "Search posts by title" }))
        .input(z.object({ q: z.string() }))
        .handler(({ input, context }) =>
          context.db.query.post.findMany({ where: { title: { contains: input.q } } }),
        ),
    { permission: "authenticated" },
  )
  .mcp()
  .build();
```

**Exposure is opt-in per procedure.** Only procedures carrying `mcp.tool()` / `mcp.resource()` / `mcp.prompt()` meta are visible — every other procedure, the whole reserved `_admin` namespace, and all `file.*` routes stay invisible to MCP clients whether or not you remember to exclude them.

**Tool names replace dots with underscores**, since dots are not legal in MCP tool names: the procedure `post.search` is listed and called as `post_search`.

| Field                             | Default                                 | Description                                                     |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `enabled`                         | `true` when called                      | Set `false` to gate it on an env flag without removing the call |
| `path`                            | `/mcp`                                  | Where the endpoint is mounted                                   |
| `serverInfo`                      | instance `name` + latest schema version | Identity reported during `initialize`                           |
| `instructions`                    | —                                       | Free-form guidance returned during `initialize`                 |
| `enableDnsRebindingProtection`    | `false`                                 | Reject `Origin`/`Host` outside the allowlists                   |
| `allowedOrigins` / `allowedHosts` | —                                       | Exact-match allowlists used when protection is on               |

Requests run through the ordinary procedure pipeline: the endpoint resolves a session exactly as `/rpc/**` does, so permissions, `context.user`, and `ownerColumn` behave identically. Browsers can authenticate with a cookie; headless clients use an API key (below).

## `.auth(config)`

Enables Better Auth and mounts `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain. Also resolves the session once per request and exposes it as `context.user` / `context.session` — no `getSession` middleware needed; see "Request context". Returns a new `Outer` whose `context.auth` type is narrowed to required (non-optional) for everything chained after this call (like `.middleware()`'s `next({ context })`). When `.auth()` is not called, `context.auth` is `undefined` and `/api/auth/**` is not mounted — resource permissions other than `"public"` will throw a configuration error.

`config` is `Omit<BetterAuthOptions, "database"> & { secret: string }` — every Better Auth option (`plugins`, `emailAndPassword`, `trustedOrigins`, etc.) is accepted directly, with `secret` made required. `database` is owned by Outer (wired to whichever dialect was configured via `new Outer({ db })`) and cannot be overridden here. `baseURL` defaults to the `baseUrl` passed to `new Outer({ baseUrl })`, but can be overridden per-call via `.auth({ baseURL })` if you need a different value just for auth.

`baseURL` accepts either a static string or Better Auth's `DynamicBaseURLConfig` (`{ allowedHosts: string[], fallback?: string, protocol?: "http" | "https" | "auto" }`), which derives the correct origin per-request from the `Host` header instead of a fixed value. Use this for deployments behind a dynamic/preview domain (Vercel previews, StackBlitz, Coolify preview deployments, etc.) where the real origin isn't known at build time — a fixed `baseUrl` there causes Better Auth to scope session cookies to the wrong origin, so sign-in appears to succeed but the session is never actually persisted:

```ts
.auth({
  secret: process.env.AUTH_SECRET!,
  baseURL: {
    // "*" allows every host — fine for scaffolding/previews, but means
    // anyone can point this server at itself with a spoofed Host header.
    // Once you have a real domain, restrict this to only the hosts you
    // actually serve, e.g. ["yourapp.com", "*.yourapp.com"].
    allowedHosts: ["*"],
    fallback: "http://localhost:3000", // must resolve to a real value — an unset env var here silently disables the fallback
  },
})
```

Patterns are matched against the full `Host` header including port — bare `"localhost"` will NOT match `"localhost:3000"`; use `"localhost:*"` if you need to restrict rather than allow all hosts.

Outer's core does not set any Better Auth defaults (no default plugins, no default email options) — configure everything explicitly.

---

### API keys (bearer tokens)

Long-lived tokens for MCP clients, CI, and server-to-server calls, via Better Auth's [`@better-auth/api-key`](https://better-auth.com/docs/plugins/api-key) plugin — a **separate install**, not part of `better-auth` core:

```bash
bun add @better-auth/api-key
```

Declare its table with [`schema().auth({ apiKeys: true })`](#auth-auth-tables), then register the plugin:

```ts
import { apiKey } from "@better-auth/api-key";

.auth({
  secret: process.env.AUTH_SECRET!,
  plugins: [
    apiKey({
      // Required. Defaults to false, in which case a key never resolves to a
      // session and every call fails with a misleading "You must be signed in".
      enableSessionForAPIKeys: true,
      // The plugin reads `x-api-key` by default. MCP clients send
      // `Authorization: Bearer <key>`, so strip the scheme:
      customAPIKeyGetter: (ctx) => {
        const header = ctx.headers?.get("authorization");
        return header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
      },
    }),
  ],
})
```

A key **authenticates as the user it belongs to**: the plugin resolves it into a session before Outer builds the request context, so `context.user`, every `.resource()` and `.procedure()` permission, `hasRole()`, and `ownerColumn` all work unchanged. There is no second authorization path to keep in sync.

Management endpoints come from the plugin at `/api/auth/api-key/create|list|delete`. **The plaintext key is returned once, at creation, and is unrecoverable** — only its hash is stored.

Pointing an MCP client at the server is then:

```
POST https://your-app.com/mcp
Authorization: Bearer <key>
```

Clients that only support the MCP OAuth discovery flow (rather than a custom header) need Better Auth's separate `mcp` plugin instead; that is not wired into `.mcp()` today.

## CORS (`new Outer({ cors })`)

Allows browser clients on other origins to call `/rpc/**` and `/api/auth/**`. Configured on the constructor — not a chain method — so it's the single source of truth for allowed origins: `.auth()` always folds them into Better Auth's `trustedOrigins`, with no call-order caveats.

```ts
new Outer({
  db: pglite(),
  cors: { origins: ["https://app.example.com"], credentials: true },
});
```

Without `cors`, no `Access-Control-Allow-Origin` header is set — same-origin requests (and non-browser clients) are unaffected, but cross-origin browser requests will be blocked by the browser.

`origins: ["*"]` allows every origin, for public APIs meant to be called from anywhere. The request's origin is echoed back rather than sent as a literal `*`, since browsers reject a wildcard `Access-Control-Allow-Origin` on credentialed requests. Combining `["*"]` with `credentials: true` lets any site make authenticated requests using a visitor's cookies — list origins explicitly for anything behind a session.

With `cors`, every response carries `Vary: Origin` (so shared caches never serve an origin-specific response to a different origin), allowed origins get `Access-Control-Max-Age: 600` on preflights, and only real preflights (OPTIONS with `Access-Control-Request-Method`) are short-circuited with `204` — custom `.route("OPTIONS", ...)` handlers still receive plain OPTIONS requests.

---

## `.admin(config?)`

Enables the admin API — schema introspection, migration status, and generic table CRUD — under the reserved `_admin` namespace, served through the existing oRPC handler at `/rpc/_admin/**` (and `/rest/_admin/**` when `.openapi()` is enabled). Designed to be consumed by an admin dashboard (hosted anywhere — the dashboard only needs the instance's URL and an admin session); nothing is stored outside the instance and no UI is bundled.

Must be called before `.build()`; can appear anywhere in the chain. Requires `.auth()` somewhere in the chain — `.build()` throws otherwise. Every admin procedure requires a signed-in session whose `user.role` includes an admin role (Better Auth admin plugin, or an equivalent `role` field on `user`). The `role` value may be a comma-separated list (as the admin plugin stores it, e.g. `"admin,support"`); access is granted when any of its roles is in `roles` (default `["admin"]`). Unauthenticated calls get `401`, non-admin sessions `403`.

```ts
new Outer({ db: pglite(), cors: { origins: ["https://admin.example.com"] } })
  .schema(v1_0)
  .auth({ secret, plugins: [admin(), bearer()] }) // Better Auth plugins
  .admin();
```

| Option      | Type                                 | Default     | Description                                                                           |
| ----------- | ------------------------------------ | ----------- | ------------------------------------------------------------------------------------- |
| `listLimit` | `{ default?: number; max?: number }` | `50/200`    | Default and max `take` for `_admin.data.list`                                         |
| `roles`     | `string[]`                           | `["admin"]` | Roles granted admin access — match Better Auth's admin plugin `adminRoles` if changed |

For a dashboard hosted on another origin, list that origin in `new Outer({ cors: { origins } })` (see CORS above), and prefer the Better Auth `bearer` plugin over cookies — cross-site cookies (`SameSite=None`) are fragile and force credentialed CORS.

### Procedures

The `_admin` namespace is reserved — `.procedure("_admin.x", ...)` throws. Rows are untyped (`Record<string, unknown>`); a UI is expected to drive itself from `_admin.meta`. The target table is a runtime input: unknown tables, unknown columns (in `where`/`orderBy`/`data`), and unknown filter operators are rejected with `400` (column names are checked against the schema since they're SQL identifiers; values stay parameterized).

The exported `OuterAdminRouter` type (`{ _admin: AdminRouter }`) is the router shape for a type-safe admin-only client — `createClient<OuterAdminRouter>({ baseUrl })` from `@outerjs/sdk` covers every `_admin.*` procedure without importing the app's server code.

| Procedure            | Input                                       | Output                   | Description                                                                                                                                                              |
| -------------------- | ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_admin.meta`        | —                                           | `AdminMeta`              | API name, dialect kind, all schema versions, whether `.openapi()` is enabled (`openapi`), tables/columns (type, nullability, PK, unique, default, references), relations |
| `_admin.migrations`  | —                                           | `AdminMigrationStatus[]` | Each migration's name and `executedAt` ISO timestamp (`null` if pending)                                                                                                 |
| `_admin.data.list`   | `{ table, where?, orderBy?, take?, skip? }` | `{ data: Row[], count }` | Sola-style filtered `SELECT` plus total matching count (for pagination UIs)                                                                                              |
| `_admin.data.get`    | `{ table, where }`                          | `Row \| null`            | First matching row                                                                                                                                                       |
| `_admin.data.create` | `{ table, data }`                           | `Row`                    | `INSERT ... RETURNING *`                                                                                                                                                 |
| `_admin.data.update` | `{ table, where, data }`                    | `Row[]`                  | Updates all matching rows, returns them; `404` if none match; touches `updatedAt` like `.resource()` does                                                                |
| `_admin.data.delete` | `{ table, where }`                          | `Row[]`                  | Deletes all matching rows, returns them; `404` if none match                                                                                                             |

`where` on writes (`update`/`delete`) accepts plain column equality only — operator objects are rejected so a filter can't silently widen a write. Constraint violations map to the same clean errors as `.resource()` (`409`/`400`).

Admin CRUD deliberately bypasses per-resource permissions (the admin role is the gate) and can browse the Better Auth tables (`user`, `session`, …). For user management actions (ban, impersonate, revoke sessions), use the Better Auth admin plugin's own endpoints at `/api/auth/admin/*` rather than raw row edits.

`.admin()` adds `_admin` to the router type, so `InferRouter`/SDK clients get typed `client._admin.meta()`, `client._admin.data.list({...})`, etc.

---

## `.schema(s: SchemaResult<T>)`

Registers a schema version for migrations and advances the DB type to `InferDB<T>`. Multiple calls accumulate in order — the migrator diffs consecutive versions.

Returns a new `Outer<OuterRpcContext<InferDB<T>>, InferDB<T>>`. After this call, `context.db` is typed as `Kysely<InferDB<T>>`.

---

## `.middleware(mw)`

Adds an oRPC middleware. The middleware receives `context` typed as the current `OuterRpcContext` (including the DB type from the latest `.schema()` call). Fields added via `next({ context: { ... } })` are merged into `TContext` and available in all subsequent `.procedure()` handlers.

```ts
.auth()
.middleware(async ({ context, next }) => {
  const session = await context.auth.api.getSession({ headers: context.headers });
  return next({ context: { user: session?.user } });
})
```

---

## `.resource(name, options?)`

Auto-generates six CRUD procedures for a schema table. `name` must match a table defined in the last `.schema()` call.

```ts
.resource("post", {
  permissions: {
    list: "public",
    get: "public",
    create: "authenticated",
    update: "owner",
    delete: "owner",
  },
  ownerColumn: "userId",
})
// Registers: post.list, post.get, post.create, post.createMany, post.update, post.delete
```

| Procedure           | Input                                                             | Output            | Description                                      |
| ------------------- | ----------------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| `{name}.list`       | `{ where?, orderBy?, take?, skip?, include? }`                    | `Row[]`           | Filtered/ordered `SELECT`                        |
| `{name}.get`        | `{ <pk>: ..., include? }`                                         | `Row \| null`     | Fetch by primary key                             |
| `{name}.create`     | Row minus serial PK and `ownerColumn`; defaulted columns optional | `Row`             | `INSERT ... RETURNING *`                         |
| `{name}.createMany` | `{ data: createInput[] }` (1–1000 rows)                           | `Row[]`           | Batch `INSERT ... RETURNING *`                   |
| `{name}.update`     | `{ where: { <pk> }, data: partialUpdateInput }`                   | `Row`             | `UPDATE ... RETURNING *`                         |
| `{name}.delete`     | `{ <pk>: ... }`                                                   | `Row`             | `DELETE ... RETURNING *`                         |
| `{name}.live`       | `{ where?, orderBy?, take? }`                                     | stream of `Row[]` | `list` as a live query — only when `live` is set |

Input types are derived from column definitions at build time. `serial` primary key columns and `ownerColumn` are omitted from create input — the database and the session own those. Columns with `.default()` are **optional** on create: omit one and the DB default applies, pass one and it wins (so a defaulted enum like `status` is still settable at creation). Nullable columns are optional too. Update `data` accepts any non–serial-PK column; `ownerColumn` is omitted there as well.

A supplied `ownerColumn` is stripped rather than rejected, so passing someone else's id cannot spoof ownership — the value from the session is used regardless.

`list` accepts the same Prisma-style query surface as Sola, validated per column type:

- `where` — plain equality values or filter objects (`equals`/`not`/`in`/`notIn`/`isNull`, plus `lt`/`lte`/`gt`/`gte` on numeric/timestamp columns and `contains`/`startsWith`/`endsWith` on text columns), combinable with `AND`/`OR`/`NOT`.
- `orderBy` — array of `{ column: "asc" | "desc" }`.
- `skip` — offset.
- `include` — see below.

`list` defaults to returning 50 rows and caps `take` at 100, and caps `skip` at 10000 so deep offsets can't force full table scans — pass `listLimit: { default, max, maxSkip }` in `options` to change these. This prevents an unbounded `SELECT *` on large tables; use `.procedure()` with `context.db.query[table].paginate(...)` directly if you need cursor pagination with metadata.

### `live` — `list` as a stream

Opt in with `live: true` (or `live: { ... }`) to register `{name}.live`: the same query as `list`, re-emitted on every change that affects the result set. Built on [Sola's live queries](#live-queries), so it needs a dialect with a `LiveProvider` (`pglite()` has one).

```ts
.resource("post", {
  permissions: { list: "owner" },
  ownerColumn: "userId",
  live: true,
})
```

It is **gated by the `list` permission**, owner scoping included — there is no separate `live` permission to forget. Owner scoping lands in the SQL `where`, so a subscriber is only ever sent their own rows.

| Option         | Type              | Default | Description                                                                                           |
| -------------- | ----------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `revalidateMs` | `number \| false` | `30000` | How often to re-check the caller's permission while the stream is open. `false` disables re-checking. |
| `max`          | `number`          | `100`   | Max concurrent subscriptions for this resource; beyond it, subscribers get `TOO_MANY_REQUESTS`.       |

Two behaviours worth knowing before exposing this publicly:

- **A subscription can outlive the session that opened it.** The permission check at subscribe time is not enough — an SSE connection stays open for hours, so a user who signs out, is banned, or loses a role would keep receiving rows. Hence `revalidateMs`: the check re-runs on that interval and the stream ends with `401`/`403` when it fails. The timer races the wait for the next change, so an **idle** subscription is cut just as promptly as a busy one — a revoked session doesn't get to sit on an open connection until the table next changes. Each re-check costs one session lookup, and it's skipped entirely when `list` is `"public"`.
- **Owner scoping filters rows, not wakeups.** A write by _any_ user to the table re-runs every subscriber's query. Nothing leaks — the `where` is applied in SQL, so other users' rows never appear — but a busy table wakes every subscription. `max` exists because each one holds a database view open, and PGlite is a single embedded instance.

`include` is not available on `live` (relations are separate queries, which one subscription can't watch), and neither is `skip`.

`list` and `get` accept `include: { relatedTable: true }` for relations declared on the table via `.relation()` in the schema **and** opted in via `includable: ["relatedTable"]` in the resource options — `hasMany`/`manyToMany` relations come back as arrays, `hasOne`/`belongsTo` as an object or `null`. Relations are not includable by default because included rows are returned as-is, without being checked against the related resource's own permission rules — only opt in relations whose rows are safe to expose alongside this one. Unknown or non-includable relation names are rejected with a `400`; naming a nonexistent relation in `includable` throws at `.resource()` time. When nothing is includable, `include` is not part of the input schema.

`contains`/`startsWith`/`endsWith` match their input literally: LIKE wildcards (`%`, `_`) in the value are escaped, so callers can't turn a substring filter into match-everything.

`create`/`update` map common Postgres constraint violations to clean errors instead of a raw 500: unique/foreign-key violations → `409 CONFLICT`, not-null/check violations → `400 BAD_REQUEST`. `update`/`delete` on a row that doesn't exist → `404 NOT_FOUND`. `update` with an empty `data` object → `400 BAD_REQUEST`. Unrecognized DB errors still surface as a generic `500` with no internal details leaked.

`.resource()` and `.build()` validate configuration eagerly rather than failing at request time: using `"owner"` on any action without `ownerColumn` throws immediately when `.resource()` is called; if any resource action's permission requires a session (`"authenticated"`, `"admin"`, or `"owner"`) but `.auth()` was never called anywhere in the chain, `.build()` throws listing the offending `resource.action` names instead of surfacing a confusing 500 on the first request.

### Permissions

| Value             | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `"public"`        | No restriction (default)                                                  |
| `"authenticated"` | User must be signed in — calls `context.auth.api.getSession()` internally |
| `"admin"`         | User must have `role === "admin"` (requires Better Auth admin plugin)     |
| `"owner"`         | User must own the row — requires `ownerColumn`; not valid for `create`    |

When `ownerColumn` is set, the current user's ID is automatically injected into `create` inserts (`createMany` injects it into every row) — no need to pass it in the request. This works for any `create` permission: `"authenticated"`/`"admin"` use the session the permission check already resolved, while `"public"` and custom-function permissions do a best-effort session lookup and inject the ID when the caller is signed in.

When `list` is `"owner"`, results are implicitly scoped to the signed-in user's rows (`ownerColumn = user.id`), AND-composed with any caller-supplied `where` filter. Unauthenticated calls get a `401`.

When `update` or `delete` is `"owner"`, the existing row is fetched first and `row[ownerColumn]` is compared to the session user's ID. Returns `403 FORBIDDEN` if they do not match.

```ts
// Full example
.resource("post", {
  permissions: {
    list: "public",        // anyone can list
    get: "public",         // anyone can read
    create: "authenticated", // must be signed in; userId auto-filled
    update: "owner",       // only the creator can edit
    delete: "admin",       // only admins can delete
  },
  ownerColumn: "userId",
})
```

---

## `.procedure(name, cb)`

Registers an oRPC procedure. `name` supports dot-notation — `"user.me"` nests the procedure as `{ user: { me: proc } }`, which is served at `POST /rpc/user/me`. Multiple procedures under the same namespace are deep-merged.

```ts
.procedure("user.me",     (base) => base.handler(...))
.procedure("user.update", (base) => base.input(z.object({...})).handler(...))
```

### Procedure permissions

An optional third argument applies a declarative access check before the handler runs, using the same vocabulary as `.resource()`:

```ts
.procedure("post.publish", (base) => base.handler(...), { permission: "authenticated" })
.procedure("stats.purge",  (base) => base.handler(...), { permission: "admin", roles: ["staff"] })
.procedure("beta.feature", (base) => base.handler(...), {
  permission: ({ context }) => context.user?.email.endsWith("@acme.com") ?? false,
})
```

| Option       | Type                                                          | Default     |
| ------------ | ------------------------------------------------------------- | ----------- |
| `permission` | `"public" \| "authenticated" \| "admin" \| (args) => boolean` | `"public"`  |
| `roles`      | `string[]` — roles accepted by `"admin"`                      | `["admin"]` |

`"authenticated"` returns `401` when signed out; `"admin"` and function permissions return `403`. There's no `"owner"` — that needs a row, which a bare procedure doesn't have; use `.resource()` or check inside the handler. Any non-public permission is registered at `.build()`, so forgetting `.auth()` throws at startup instead of failing per-request.

---

## `.route(method, path, handler)`

Mounts a raw H3 route alongside `.procedure()`-defined RPC routes — for webhooks, custom REST endpoints, or anything that doesn't fit the oRPC shape. `handler` receives the H3 `event` and the same `context` (`headers`, `db`, `auth`, `user`, `session`, `storage`) available in procedure handlers — including the already-resolved session, so raw routes authorize the same way procedures do. Registered before `/rpc/**`, so it takes precedence on overlapping paths.

```ts
.route("post", "/webhooks/stripe", async (event, { db }) => {
  const body = await event.req.json();
  // ...
  return new Response("ok");
})
```

Route params are available as `event.context.params`.

---

## `.files(config?)` (file uploads)

Registers a complete upload surface — six `file.*` procedures plus a download route — from the `file` tables `schema().files()` defines. Requires an `OuterStorage`.

```ts
import { Outer, fromUnstorage } from "@outerjs/server";

new Outer({ db: pglite(), storage: fromUnstorage(useStorage("fs")) })
  .schema(v1_1) // schema(...).auth().files({ attachTo: ["post"] })
  .auth({ secret })
  .files()
  .build();
```

| Procedure        | Input                                       | Notes                                          |
| ---------------- | ------------------------------------------- | ---------------------------------------------- |
| `file.upload`    | `{ file, name?, attach? }`                  | Returns a `FileRecord` including `url`         |
| `file.list`      | `{ attachedTo?, take?, skip? }`             | Non-admins only ever see their own files       |
| `file.get`       | `{ id }`                                    | `null` when missing, like `.resource().get`    |
| `file.delete`    | `{ id }`                                    | Removes the row, then the bytes                |
| `file.attach`    | `{ id, table, entityId, role?, position? }` | Links an existing file to a row                |
| `file.detach`    | `{ id, table, entityId }`                   | Unlinks it                                     |
| `GET /files/:id` | —                                           | Serves the bytes; path configurable via `path` |

Uploads travel the ordinary typed-SDK path: oRPC's codec detects the `File` field and switches the request to `multipart/form-data` on its own, so `client.file.upload({ file })` just works from the browser.

| Option        | Type                             | Default                                             |
| ------------- | -------------------------------- | --------------------------------------------------- |
| `storage`     | `OuterStorage`                   | the `new Outer({ storage })` instance               |
| `maxBytes`    | `number`                         | `10 * 1024 * 1024` — larger uploads get `413`       |
| `accept`      | `string[]` (`"image/*"` allowed) | all types                                           |
| `permissions` | `{ upload, list, get, delete }`  | upload/list `"authenticated"`, get/delete `"owner"` |
| `path`        | `string` containing `:id`        | `"/files/:id"`                                      |
| `roles`       | `string[]`                       | `["admin"]`                                         |

**Defaults are private.** `"owner"` means only `file.userId` can read or delete a file — the download route returns `404` (not `403`) to everyone else, so file IDs can't be probed for existence. Admins bypass ownership so moderation tools need no second code path. Set `permissions: { get: "public" }` for avatars and other world-readable assets; the route switches to `Cache-Control: public` accordingly.

Ordering is deliberate: on upload the row commits **before** the bytes are written, and on delete the row is removed **before** the bytes. A failure leaves at worst a retryable orphaned blob, never a database row pointing at bytes that aren't there.

`attach` / `attachedTo` use the pivot tables from `schema().files({ attachTo })`. Attaching to a table that wasn't listed there is a `400` naming the fix.

### `OuterStorage`

Three methods, deliberately tiny so core never depends on unstorage, S3, or a filesystem:

```ts
type OuterStorage = {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
};
```

Three adapters ship with the package:

- `fromUnstorage(storage)` — any [unstorage](https://unstorage.unjs.io) instance, including Nitro's `useStorage()`. Moving from `fs-lite` to S3/R2 in production is a driver change in your Nitro config; no application code moves.
- `fromS3(client, commands, bucket)` — `@aws-sdk/client-s3` or an R2 binding.
- `memoryStorage()` — a `Map`, for tests.

Uploads are buffered in memory, so `maxBytes` is a real ceiling. For large media, issue presigned URLs and upload directly to the bucket instead of through the Outer process.

---

## `.build(): BuiltOuter`

Seals the router and constructs the HTTP server. Returns a `BuiltOuter` with:

- `handle(request: Request): Promise<Response>` — fetch-compatible handler
- `migrator` — Kysely `Migrator` instance (see Migrations)
- `db` — the same typed `context.db` handed to procedures (Kysely + `query` + `transact`), for out-of-band work like seeding after migrations (e.g. upserting a single admin account from an `ADMIN_EMAIL` env var, as the minimal template does)
- `client(headers?)` — in-process `RouterClient<TRouter>` (oRPC's `createRouterClient`) that calls procedures directly, skipping HTTP and the oRPC wire protocol. For SSR (Server Components, server functions) where Outer runs in the same process as the frontend. `headers` is a `Headers` or a `() => Headers | Promise<Headers>` (evaluated per call — pass the framework's request-headers accessor so permissions and `context.auth` see the caller's session); defaults to empty headers. The session is resolved from those headers exactly as the HTTP path does, so `context.user` and every permission check behave identically.
- `close()` — releases the database pool (and the embedded PGlite instance with it) plus any rate-limit timers. Call it from your `SIGTERM`/`SIGINT` handler, and in tests that build more than one instance. Idempotent; the instance must not be used afterwards.

```ts
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
```

```ts
// e.g. Next.js Server Component
import { headers } from "next/headers";
const api = outer.client(() => headers());
const posts = await api.post.list({});
```

---

## HTTP routes

| Method | Path            | Handler                                                                                 |
| ------ | --------------- | --------------------------------------------------------------------------------------- |
| `GET`  | `/openapi.json` | OpenAPI 3.x spec (only mounted when `.openapi({ enabled: true })` was called)           |
| `ALL`  | `/api/auth/**`  | Better Auth handler (only mounted when `.auth()` was called)                            |
| `ALL`  | `/rpc/**`       | oRPC handler (prefix `/rpc`)                                                            |
| `ALL`  | `/rest/**`      | Plain-JSON OpenAPI handler (only mounted when `.openapi()` was called)                  |
| `ALL`  | `/mcp`          | MCP Streamable HTTP endpoint (only mounted when `.mcp()` was called; path configurable) |
| `GET`  | `/health`       | Liveness probe with a `select 1` check (mounted unless `health: false`)                 |
| `GET`  | `/files/:id`    | File download (only mounted when `.files()` was called; path configurable)              |

---

## Embedding in a host framework

`BuiltOuter.handle(request: Request): Promise<Response>` is a plain Fetch API handler, so Outer mounts as the server entry for any framework that speaks `fetch` — Nitro, Hono, H3, Next.js API Routes, etc. Export whatever shape the host expects and delegate to `outer.handle`:

The handler itself is host-agnostic, but if you're using `pglite()` (the recommended default), PGlite is not: it writes to local disk (`dataDir`), so the host needs a persistent, writable filesystem across requests. This works on a VPS, Coolify, or any long-lived Node process; it does not work on serverless/edge platforms (Vercel Functions, Cloudflare Workers) unless you swap in a different dialect — see "Custom dialects" and Roadmap.

```ts
// e.g. Nitro server entry (see templates/ilha)
export default { fetch: (req: Request) => outer.handle(req) };
```

Use `.middleware()` to pull the host runtime's own utilities into `context`, alongside `context.db`/`context.auth`, so they're available in every `.procedure()`:

```ts
import { useStorage } from "nitro/storage";
import { runTask } from "nitro/task";

const outer = new Outer(...)
  .schema(v1_0)
  .auth({ secret: useRuntimeConfig().authSecret })
  .middleware(async ({ context, next }) => {
    const kv = useStorage();
    return next({ context: { kv, runTask } });
  })
  .procedure("foo", (base) =>
    base.handler(async ({ context }) => {
      await context.kv.setItem("foo", "bar");
      return { foo: await context.kv.getItem("foo") };
    }),
  )
  .build();
```

This is the same pattern regardless of host — swap `nitro/storage`/`nitro/task` for whatever the framework provides (Cloudflare bindings, Next.js `headers()`, etc.).

---

## Request context

Available in every procedure handler:

```ts
type OuterRpcContext<TDB> = {
  headers: Headers;
  auth?: OuterAuth; // Better Auth instance; undefined if .auth() was not called
  db: OuterDB<TDB>; // Kysely<TDB> + .query (sola)
  user: SessionUser | null; // resolved once per request; null when signed out
  session: UserSession | null;
  storage?: OuterStorage; // the object store passed to new Outer({ storage })
};
```

### `context.user` / `context.session`

When `.auth()` is called, Outer resolves the session **once per request** and shares it with every procedure, raw route, and permission check. No `getSession` middleware needed:

```ts
.procedure("user.me", (base) => base.handler(({ context }) => context.user))
```

Both are `null` for anonymous callers, and always `null` when `.auth()` was never called. After `.auth()` the types narrow from optional to `SessionUser | null` / `UserSession | null`, so `context.user` no longer needs a `?.`. Because the lookup is shared, a request that touches auth costs exactly one session query no matter how many procedures or checks read it.

The session `user` only carries plugin fields (like `role`) when the corresponding Better Auth plugin is registered — add `admin()` to `.auth({ plugins })` if you use `"admin"` permissions.

### `context.db`

Full Kysely instance typed to the latest schema. Use for raw queries and writes:

```ts
context.db.insertInto("user").values({...}).execute()
context.db.selectFrom("session").where("userId", "=", id).selectAll().execute()
```

### `context.db.transact(fn)`

Runs `fn` inside a database transaction and returns its result. The `trx` argument is a full `context.db` — Kysely methods _and_ `trx.query` (Sola) both participate in the transaction. Throwing inside `fn` rolls everything back.

```ts
const result = await context.db.transact(async (trx) => {
  const { id } = await trx.insertInto("order").values({...}).returning("id").executeTakeFirstOrThrow();
  await trx.updateTable("inventory").set(...).execute();
  return trx.query.order.findFirst({ where: { id } });
});
```

### `context.db.query`

Sola ORM layer (see below). Read-focused ergonomic API over the same Kysely instance.

---

## Schema (`schema()`)

```ts
const v1_0 = schema("1.0.0")
  .table("user", (t) => ({
    id: t.text().primaryKey(),
    email: t.text().unique(),
    name: t.text(),
    image: t.text().nullable(),
  }))
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    body: t.text().nullable(),
    authorId: t.text().references("user", "id"),
  }))
  .relation("user", (rel) => rel.hasMany("post", { from: "id", to: "authorId" }))
  .relation("post", (rel) => rel.belongsTo("user", { from: "authorId", to: "id" }))
  .build();
```

### Column types

`text` · `varchar` · `integer` · `serial` · `bigint` · `decimal` · `real` · `boolean` · `timestamp` · `date` · `jsonb` · `uuid` · `bytes`

| Column    | Postgres           | SQLite    | TS type      | Notes                                                                                    |
| --------- | ------------------ | --------- | ------------ | ---------------------------------------------------------------------------------------- |
| `bigint`  | `bigint`           | `integer` | `string`     | 64-bit; a JS `number` loses precision past 2^53, so it is read and written as a string   |
| `decimal` | `numeric`          | `text`    | `string`     | Exact. SQLite maps to `text`, not `NUMERIC`, whose float affinity would defeat the point |
| `real`    | `double precision` | `real`    | `number`     | Approximate; don't store money in it                                                     |
| `date`    | `date`             | `text`    | `Date`       | Calendar date, no time component                                                         |
| `bytes`   | `bytea`            | `blob`    | `Uint8Array` | Raw bytes                                                                                |

### Column modifiers

`.primaryKey()` · `.unique()` · `.nullable()` · `.index()` · `.default(value)` · `.defaultSql(expr)` · `.references(table, column, actions?)` · `.enum(values, options?)`

#### `.default(value)` / `.defaultSql(expr)`

`.default()` takes the **value**, quoted for you by column type — not a SQL fragment:

```ts
t.text().default("user"); // → default 'user'
t.boolean().default(false); // → default false   (postgres) / default 0 (sqlite)
t.integer().default(0); // → default 0
```

Embedded quotes are escaped, and an enum column only accepts one of its declared values. For expressions, use `.defaultSql("CURRENT_TIMESTAMP")`, which is emitted verbatim.

#### `.references(table, column, actions?)`

```ts
userId: t.text().references("user", "id", { onDelete: "cascade" });
```

`onDelete`/`onUpdate` accept `"cascade"`, `"set null"`, `"restrict"`, or `"no action"`. **Without one, deleting a referenced row fails with a foreign-key violation** — so the built-in `.auth()` tables cascade `session.userId` and `account.userId`, and `.files()` cascades its pivots and sets `file.userId` to null.

#### `.index()`

Adds a non-unique index named `{table}_{column}_idx`. `.unique()` columns already have one, so `.index()` on them is a no-op rather than a duplicate. The built-in FK columns are indexed.

`timestamp` maps to `timestamptz` in DDL.

#### `.enum(values, options?)`

Restricts a `text`/`varchar` column to a declared set of values (throws at build time on any other column type, on an empty list, or on a value containing a comma):

```ts
.table("doc", (t) => ({ status: t.text().enum(["draft", "published"]).default("'draft'") }))
```

The column's TS type narrows from `string` to the union, so `context.db` writes and resource inputs reject anything else, and `.resource()` procedures validate against the list with `z.enum`. `_admin.data.create/update` check it too, since admin rows are untyped. `_admin.meta` reports the values as `columns[].enum` (`null` when unconstrained) — the hub uses that to render a `<Select>` instead of a text input.

##### `{ multiple: true }`

Stores a **set** of the declared values in the one text column, comma-separated — the format Better Auth's admin plugin already uses for `user.role`, and the one `hasRole()` reads:

```ts
.table("user", (t) => ({ role: t.text().enum(["user", "admin", "support"], { multiple: true }) }))
// "admin,support"  ✓     "admin,root"  ✗ (unknown role)     "admin,admin"  ✗ (duplicate)
```

Each part is validated independently; unknown parts and duplicates are rejected. The TS type stays `string` rather than becoming a union — enumerating every legal combination is combinatorial — so use the exported `parseSet(value)` to read one and `toSet(values)` to build one. `_admin.meta` reports `columns[].multiple`, which the hub renders as a checkbox group.

**The SQL type is unchanged** — the column stays `text`, with no `CREATE TYPE` and no `CHECK` constraint. The constraint is enforced by Outer, not the database, so editing the value list never produces a migration and existing rows are never rejected retroactively. Values written outside Outer (raw SQL, another client) are not validated.

`.auth()` deliberately leaves `user.role` unconstrained: Better Auth's admin plugin allows custom role names and comma-separated lists (`"support,admin"`). Apps that want a fixed set opt in, either through `.auth({ roles })` or by re-declaring the column:

```ts
schema("1.0.0").auth({ roles: ["user", "admin"] });
// identical to:
schema("1.0.0")
  .auth()
  .table("user", (t) => ({ role: t.text().enum(["user", "admin"]).default("'user'") }));
```

`roles` is the shorter form and keeps the column's default without restating it; re-declaring is what you want when changing anything else about `role`.

### `timestamps(t)`

Returns `createdAt` and `updatedAt` (`timestamp`, default `CURRENT_TIMESTAMP`) to spread into a table definition:

```ts
.table("todo", (t) => ({
  id: t.text().primaryKey(),
  title: t.text(),
  ...timestamps(t),
}))
```

Resource `update` procedures automatically touch `updatedAt` (any table with a `timestamp` column of that name) unless the caller sets it explicitly. Writes made directly via `context.db` do not — set it yourself there.

### `.auth()` (auth tables)

Registers the Better Auth core schema — `user`, `session`, `account`, `verification` (per [Better Auth's database docs](https://better-auth.com/docs/concepts/database)) — with the admin plugin's fields included by default: `user.role` (default `'user'`), `user.banned`, `user.banReason`, `user.banExpires`, and `session.impersonatedBy`. Email OTP needs no extra columns (it uses the `verification` table). Also registers the relations: `user` `hasMany` `session`/`account` and the inverse `belongsTo`s.

```ts
const v1_0 = schema("1.0.0")
  .auth()
  .table("todo", (t) => ({ id: t.text().primaryKey(), title: t.text(), ...timestamps(t) }))
  .build();
```

`.auth({ roles })` narrows `user.role` to a fixed set — see [`.enum(values)`](#enumvalues) — while leaving its `'user'` default intact:

```ts
schema("1.0.0").auth({ roles: ["user", "admin"] });
// user.role is typed "user" | "admin"; writes outside the set are rejected,
// and `_admin.meta` reports the values so the hub renders a select.
```

Omitted by default, because Better Auth's admin plugin permits custom role names and comma-separated lists (`"support,admin"`) that a closed set would reject.

`.auth({ apiKeys: true })` additionally declares the `apikey` table required by `@better-auth/api-key` (hashed `key`, owning `referenceId`, expiry, rate-limit and refill bookkeeping). The plugin owns those rows; Outer only declares the DDL so the migrator creates them. See [API keys](#api-keys-bearer-tokens).

Re-declaring a table merges columns (later definition wins on name collisions), so auth tables can be extended:

```ts
schema("1.0.0")
  .auth()
  .table("user", (t) => ({ plan: t.text().default("'free'") })); // adds to the auth user table
```

The tables are typed like hand-written ones (exported as `AuthTables`), so `context.db.query.user` etc. stay fully typed. Pairs with the Better Auth `admin()` plugin and `.admin()` on the `Outer` chain, which both expect these fields.

### `.files(options?)` (file tables)

Registers a `file` metadata table for blobs held in an object store — the bytes stay in unstorage/S3/R2, only the pointer and ownership live in Postgres. The counterpart to `.auth()` for uploads.

```ts
const v1_1 = schema("1.1.0")
  .auth()
  .table("post", (t) => ({ id: t.text().primaryKey(), title: t.text() }))
  .files({ attachTo: ["post"] })
  .build();
```

`file` columns: `id` (PK), `key` (unique — the storage key the bytes live under), `name`, `type` (MIME), `size` (integer), `userId` (nullable, references `user`), plus `timestamps(t)`. The `key` uniqueness constraint means a blob can never be double-registered.

**`owner`** (default `true`) adds `file.userId` and the `user hasMany file` / `file belongsTo user` relations — so it requires `.auth()`. Pass `owner: false` for files with no per-user owner; the column and both relations are omitted, and the type drops `userId` too.

**`attachTo`** links files to existing tables. Each name `x` gets a pivot table `x_file`:

| Column     | Purpose                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| `id`       | PK                                                                                            |
| `fileId`   | references `file.id`                                                                          |
| `entityId` | references `x.id`                                                                             |
| `role`     | nullable label, so one table can carry several kinds of attachment (`"avatar"`, `"cover"`, …) |
| `position` | integer, default `0` — sort key for ordered galleries                                         |

plus a `manyToMany` relation in both directions, so `context.db.query` traverses `post → file` and `file → post`. `attachTo` only accepts tables already declared on the builder; unknown names are a type error.

The tables are typed like hand-written ones (exported as `FileTables`), and both foreign keys are enforced at the database level.

Outer deliberately stops at the schema: it does not read, write, or serve the bytes. See "File uploads" for the procedure and route side.

### Relation kinds

`hasMany` · `hasOne` · `belongsTo` · `manyToMany`

### Type inference

`SchemaResult<T>["_db"]` is the fully inferred Kysely database type — `{ [tableName]: { [column]: TSType } }`. Nullable columns become `TSType | null | undefined`.

---

## Migrations

```ts
const { error, results } = await server.migrator.migrateToLatest();
```

Uses a custom `SchemaMigrationProvider` that diffs consecutive schema versions. Each `schema("x.y.z")` call becomes one Kysely migration keyed by its version string. Diffing (which schema is "previous" vs "current") happens in numeric-per-segment version order. Kysely itself still applies migrations in plain lexicographic order of the version-string keys — for double-digit segments this can disagree with numeric order (`"1.10.0"` sorts before `"1.2.0"` as a string). `getMigrations()` detects this mismatch and throws before migrating, telling you to zero-pad segments (e.g. `"1.02.00"`) so lexicographic and numeric order match.

**Up** — creates new tables, adds new columns (with their indexes), drops removed columns.  
**Down** — reverses: drops added tables/columns, restores dropped ones.

### Changed columns are refused, not ignored

Editing a column **in place** — its type, nullability, default, uniqueness, primary key, foreign key, or index — produces no add and no drop, so there is nothing for the diff to emit. Rather than migrate to nothing and leave the schema and database silently disagreeing, `getMigrations()` throws, naming each offending table and column:

```
Schema version "2.0.0" changes existing columns, which Outer cannot migrate automatically:
  thing
    name: became nullable
```

Adding and dropping columns is supported; altering one is not. Either revert the edit or write the `ALTER` yourself and keep the schema in sync.

**Renaming a column is a drop plus an add**, which the diff will happily perform — and that destroys the old column's data. Copy the data across yourself before removing the old name.

---

## Sola ORM (`context.db.query`)

Read-focused ORM layer. Table names match the schema exactly (singular: `user`, `session`).

### `findMany(args?)`

```ts
const users = await context.db.query.user.findMany({
  where: { email: { contains: "acme.com" } },
  include: { session: { orderBy: [{ createdAt: "desc" }], take: 5 } },
  orderBy: [{ createdAt: "desc" }],
  take: 20,
  skip: 0,
});
```

### `findFirst(args?)`

Same as `findMany` but returns `T | null` (applies `LIMIT 1` internally).

### `findUnique({ where })`

Lookup by exact field value. Throws if no record found. `where` accepts direct values only (no filter operators).

```ts
const user = await context.db.query.user.findUnique({ where: { id: "abc" } });
```

### `count(args?)`

```ts
const n = await context.db.query.user.count({ where: { emailVerified: true } });
```

### `exists(args?)`

```ts
const taken = await context.db.query.user.exists({ where: { email: "x@y.com" } });
```

Uses `SELECT 1 ... LIMIT 1` — cheaper than `count`.

### `paginate(args)`

`orderBy` and `take` are required.

**Offset mode** (pass `skip`):

```ts
const page = await context.db.query.user.paginate({
  orderBy: [{ createdAt: "desc" }],
  take: 20,
  skip: 40,
});
```

**Cursor mode** (pass `after` or `before`):

```ts
const page1 = await context.db.query.user.paginate({ orderBy: [{ id: "desc" }], take: 20 });
const page2 = await context.db.query.user.paginate({
  orderBy: [{ id: "desc" }],
  take: 20,
  after: page1.pagination.endCursor!,
});
```

Result shape:

```ts
{
  data: T[],
  pagination: {
    count:       number,   // total matching rows
    hasNext:     boolean,
    hasPrevious: boolean,
    startCursor: string | null,  // null in offset mode
    endCursor:   string | null,  // null in offset mode
  }
}
```

Cursors are opaque base64-encoded strings derived from `orderBy` column values. Multi-column `orderBy` uses correct row-comparison keyset semantics — always include a unique column (e.g. `id`) as the final `orderBy` entry to guarantee stable pages.

### Live queries

`live()` is `findMany()` as a stream: it emits the full result set immediately, then re-emits whenever a change affects it. Same arguments, same query — the SQL is built by the same code path, so a live stream and a one-shot read can't drift apart.

```ts
.procedure("post.live", (base) =>
  base.handler(({ context, signal }) =>
    context.db.query.post.live({ where: { done: false }, orderBy: [{ id: "desc" }], take: 20 }, { signal }),
  ),
)
```

Because it returns an `AsyncIterable`, a handler can return it directly and oRPC streams it over SSE — no `EventPublisher`, and no need for every mutation path to remember to publish. The database is the source of truth.

| Method                        | Emits     |
| ----------------------------- | --------- |
| `live(args?, options?)`       | `T[]`     |
| `liveCount(args?, options?)`  | `number`  |
| `liveExists(args?, options?)` | `boolean` |

`options.signal` ends the stream and releases the underlying subscription; pass a procedure's `signal` so a disconnecting client tears its query down. Breaking out of a `for await` loop releases it too.

Emissions **coalesce**: a live query's payload is a snapshot, not an event log, so ticks arriving while the consumer is busy collapse into the newest one. Memory stays bounded no matter how fast writes land.

**Requires a `LiveProvider`.** `pglite()` ships one. On dialects without one, `live*()` throws `NOT_IMPLEMENTED` rather than silently degrading to a one-shot read. To supply your own — Postgres `LISTEN`/`NOTIFY`, or polling — pass it alongside the dialect:

```ts
new Outer({ db: { dialect, kind: "postgres", live: myProvider } });

type LiveProvider = {
  subscribe(args: {
    sql: string;
    parameters: readonly unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<Record<string, unknown>[]>;
};
```

**`include` is not supported.** Relations load as separate queries, which a single subscription can't watch; passing `include` throws with that explanation. Subscribe to the related table separately.

Each subscription costs database resources (PGlite maintains a view and triggers per live query), and PGlite is one embedded instance — so subscription count scales with connected clients. Prefer one broad subscription fanned out in your app over one per client, and cap what you expose publicly.

### `where` operators

| Operator                    | Types        | SQL                                          |
| --------------------------- | ------------ | -------------------------------------------- |
| `equals`                    | all          | `= val`                                      |
| `not`                       | all          | `!= val`                                     |
| `in`                        | all          | `IN (...)`                                   |
| `notIn`                     | all          | `NOT IN (...)`                               |
| `lt` / `lte` / `gt` / `gte` | number, Date | `< <= > >=`                                  |
| `contains`                  | string       | `LIKE %val%`                                 |
| `startsWith`                | string       | `LIKE val%`                                  |
| `endsWith`                  | string       | `LIKE %val`                                  |
| `isNull: true`              | nullable     | `IS NULL`                                    |
| `isNull: false`             | nullable     | `IS NOT NULL`                                |
| `AND`                       | —            | implicit (multiple fields) or explicit array |
| `OR`                        | —            | `OR(...)`                                    |
| `NOT`                       | —            | `NOT(...)`                                   |

`AND`/`OR`/`NOT` nest arbitrarily (e.g. an `AND` array inside an `OR` clause). `contains`/`startsWith`/`endsWith` escape LIKE wildcards (`%`, `_`) in the value, so user input always matches literally.

### `include`

Loads related tables defined via `.relation()` in the schema. Uses separate queries per relation (Prisma-style) — one extra query per included relation, results merged in JS.

- `hasMany` / `manyToMany` → array on the result
- `belongsTo` / `hasOne` → single object or `null`

Nested include is not supported — max one level of relations per query. `manyToMany` includes require `pivotTable` to be set on the relation definition; Outer performs a two-hop join through the pivot table automatically.

---

## Request context

Available in every procedure handler:

```ts
type OuterRpcContext<TDB> = {
  headers: Headers;
  auth?: OuterAuth;
  db: OuterDB<TDB>;
};
```

---

## `outer.router` (type extraction)

Both the `Outer` instance and `BuiltOuter` (the return value of `.build()`) expose a `router` property with the internal oRPC router type. Use the exported `InferRouter<T>` helper to extract it from either:

```ts
// src/index.ts
export const outer = new Outer(...)
  .schema(v1_0)
  .procedure("user.me", (base) => base.handler(...))
  .build();
```

```ts
// outer.types.ts
import type { RouterClient } from "@orpc/server";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./src/index.js";

export type Router = InferRouter<typeof outer>;
export type AppClient = RouterClient<Router>;
```

Outer's core has no CLI — write the file above by hand, or generate it with your own script if you want automation.

`.procedure()` fully infers each procedure's `.input()`/`.output()` types into the router, so `client.foo(...)`, `client.user.me(...)`, etc. are properly typed on `RouterClient<Router>`.

`.resource()` is strictly typed too: the six generated procedures (`list`/`get`/`create`/`createMany`/`update`/`delete`) get their input and output types derived from the table's column definitions (`ResourceProcedures` in `resource.ts`, mirroring the runtime Zod schemas). Concretely:

- Rows come back with each column's TS type (`serial`/`integer` → `number`, `timestamp` → `Date | string` since drivers differ, nullable columns → `T | null`).
- `create`/`createMany` inputs omit serial primary keys and the resource's `ownerColumn` (auto-filled from the session); columns with `.default()` and nullable columns are optional.
- `update` `data` is a partial of all updatable columns (serial PK and `ownerColumn` omitted; defaulted columns such as booleans are included so `false` is valid).
- `get`/`update`/`delete` take `{ <pk>: value }` typed from the declared primary key column.
- `list` accepts a typed `where` filter (per-column values or operator objects), `orderBy`, `take`, and `skip`.

One gap: relation `include`s aren't tracked at the type level — `include` accepts any `Record<string, boolean>` (unknown relation names are rejected at runtime), and included relations don't appear on the row type.

---

## OpenAPI

`GET /openapi.json` — enabled via `.openapi({ enabled: true })` — returns an OpenAPI 3.x document generated by `@orpc/openapi`. Title comes from `name` param, version from the last registered schema. Procedures with `.input(zodSchema)` / `.output(zodSchema)` are fully documented. Output schema is not inferred from handler return types — explicit `.output()` is required for response documentation.

Enabling `.openapi()` also mounts the router at `/rest/**` via oRPC's `OpenAPIHandler`, so the spec is directly callable with plain JSON (e.g. `POST /rest/post/create` with `{"title": "..."}`), and the spec advertises `<baseUrl>/rest` as its server URL. `/rpc/**` remains the typed-SDK transport.

---

## Realtime

Outer supports realtime streaming via oRPC's built-in event iterator (SSE) support. No additional infrastructure is needed — the existing `/rpc/**` handler streams async generators automatically.

### Basic event stream

```ts
import { eventIterator } from "@orpc/server";

.procedure("notifications.stream", (base) =>
  base
    .output(eventIterator(z.object({ message: z.string() })))
    .handler(async function* ({ context, signal }) {
      while (!signal?.aborted) {
        const notification = await waitForNotification(context.db);
        yield { message: notification.text };
      }
    })
)
```

### Fan-out with `EventPublisher`

For broadcasting events across procedures (e.g. subscribe to mutations triggered by other users), instantiate an `EventPublisher` at module scope and reference it in your procedures:

```ts
import { EventPublisher, withEventMeta } from "@orpc/server";

const postEvents = new EventPublisher<{ created: { id: number; title: string } }>();

const server = new Outer(...)
  .procedure("post.create", (base) =>
    base.input(z.object({ title: z.string() })).handler(async ({ context, input }) => {
      const row = await context.db.insertInto("post").values(input).returningAll().executeTakeFirstOrThrow();
      postEvents.publish("created", row);
      return row;
    })
  )
  .procedure("post.live", (base) =>
    base
      .output(eventIterator(z.object({ id: z.number(), title: z.string() })))
      .handler(async function* ({ signal }) {
        for await (const payload of postEvents.subscribe("created", { signal })) {
          yield withEventMeta(payload, { id: String(payload.id) });
        }
      })
  )
  .build();
```

### Resume support

Use `withEventMeta` to attach an event `id` to each yield. On reconnect, oRPC passes the last seen ID as `lastEventId` so the handler can resume from a known position:

```ts
.handler(async function* ({ lastEventId }) {
  // fetch missed events from DB if lastEventId is set
  if (lastEventId) { /* replay from DB */ }
  for await (const event of publisher.subscribe("updated", { signal })) {
    yield withEventMeta(event, { id: event.id });
  }
})
```

### Serverless caveat

`EventPublisher` is in-memory and tied to a single process. It works correctly on VPS, Coolify, or any long-lived single-instance deployment. On multi-instance platforms (Cloudflare Workers, Vercel serverless functions, horizontally scaled Node), events published in one instance are not visible to subscribers in other instances. For those environments, route events through an external pub/sub system (Redis, Cloudflare Durable Objects, etc.) and subscribe from there instead of from a module-level `EventPublisher`.

---

## Roadmap

Alpha focuses on persistent-hosting deployments (VPS, Coolify) with `pglite()` as the recommended default. One thing is planned next:

- **Admin dashboard/UI** — comparable to PocketBase's dashboard or Supabase Studio. The server side is done: `.admin()` (see above) exposes schema introspection, migration status, and table CRUD under `/rpc/_admin/**`, guarded by the admin role. What remains is the dashboard app itself — a static SPA that takes an Outer instance URL and authenticates against it (hosted centrally, run locally, or later mountable at `/admin` via a separate `outer-admin` package).

Serverless/edge support (Vercel Functions, Cloudflare Workers) is no longer blocked — `db: { dialect, kind }` (see "Custom dialects" above) lets you swap PGlite for a network-attached Postgres or a `"sqlite"`-family dialect, with working, verified templates for both (`templates/cloudflare`, Durable Objects; `templates/vercel-neon`, Neon Postgres). `mysql`/`mssql` `kind`s still aren't implemented (Kysely ships dialects for both, but Outer's DDL generation and error mapping don't cover them).

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

Order matters: `.schema()` → `.middleware()` → `.procedure()` → `.build()`. `.auth()` and `.openapi()` can appear anywhere in the chain.

---

## `new Outer(params)`

| Param        | Type                     | Default       | Description                                                                                                   |
| ------------ | ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`       | `string`                 | `"Outer API"` | API title in OpenAPI spec                                                                                     |
| `baseUrl`    | `string`                 | —             | Default `baseURL` passed to Better Auth when `.auth()` is called (override per-call via `.auth({ baseURL })`) |
| `db.dialect` | `Dialect`                | —             | Required. A Kysely `Dialect` — see below                                                                      |
| `db.kind`    | `"postgres" \| "sqlite"` | —             | Required. Drives DDL generation, Better Auth's schema, and DB error mapping — must match `db.dialect`         |

`db` is required — `@outerjs/server`'s core has no database opinion baked in. For the zero-infra default (embedded [PGlite](https://pglite.dev), real Postgres, writes to local disk, no external infra to run), import the helper from the `/pglite` subpath rather than the framework's dependency tree pulling it in unconditionally:

```ts
import { Outer } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";

new Outer({ db: pglite() }); // or pglite({ dataDir: "..." }), defaults to <cwd>/.outer/pglite
```

This is the path to reach for first; it's what makes Outer deployable to a VPS/Coolify box with nothing else to provision. Splitting it into a subpath keeps PGlite's WASM out of deploy bundles for platforms where it's dead weight (Cloudflare Workers, Vercel Functions) — see `templates/cloudflare` and `templates/vercel-neon`.

`@electric-sql/pglite` is an **optional peer dependency**: apps that use `pglite()` must install it themselves (`bun add @electric-sql/pglite`), and apps on other dialects (Durable Objects, Neon, network Postgres) never download its WASM at all.

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

## `.auth(config)`

Enables Better Auth and mounts `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain. Returns a new `Outer` whose `context.auth` type is narrowed to required (non-optional) for everything chained after this call (like `.middleware()`'s `next({ context })`). When `.auth()` is not called, `context.auth` is `undefined` and `/api/auth/**` is not mounted — resource permissions other than `"public"` will throw a configuration error.

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

## `.cors(config)`

Allows browser clients on other origins to call `/rpc/**` and `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain — if used before `.auth()`, its `origins` are also merged into Better Auth's `trustedOrigins` automatically.

```ts
.cors({ origins: ["https://app.example.com"], credentials: true })
```

Without `.cors()`, no `Access-Control-Allow-Origin` header is set — same-origin requests (and non-browser clients) are unaffected, but cross-origin browser requests will be blocked by the browser.

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

| Procedure           | Input                                             | Output        | Description                    |
| ------------------- | ------------------------------------------------- | ------------- | ------------------------------ |
| `{name}.list`       | `{ where?, orderBy?, take?, skip?, include? }`    | `Row[]`       | Filtered/ordered `SELECT`      |
| `{name}.get`        | `{ <pk>: ..., include? }`                         | `Row \| null` | Fetch by primary key           |
| `{name}.create`     | Row minus serial PK, defaults, and `ownerColumn`  | `Row`         | `INSERT ... RETURNING *`       |
| `{name}.createMany` | `{ data: createInput[] }` (1–1000 rows)           | `Row[]`       | Batch `INSERT ... RETURNING *` |
| `{name}.update`     | `{ where: { <pk> }, data: Partial<createInput> }` | `Row`         | `UPDATE ... RETURNING *`       |
| `{name}.delete`     | `{ <pk>: ... }`                                   | `Row`         | `DELETE ... RETURNING *`       |

Input types are derived from column definitions at build time. `serial` primary key columns, columns with `.default()`, and `ownerColumn` are omitted from create input.

`list` accepts the same Prisma-style query surface as Sola, validated per column type:

- `where` — plain equality values or filter objects (`equals`/`not`/`in`/`notIn`/`isNull`, plus `lt`/`lte`/`gt`/`gte` on numeric/timestamp columns and `contains`/`startsWith`/`endsWith` on text columns), combinable with `AND`/`OR`/`NOT`.
- `orderBy` — array of `{ column: "asc" | "desc" }`.
- `skip` — offset.
- `include` — see below.

`list` defaults to returning 50 rows and caps `take` at 100 — pass `listLimit: { default, max }` in `options` to change these. This prevents an unbounded `SELECT *` on large tables; use `.procedure()` with `context.db.query[table].paginate(...)` directly if you need cursor pagination with metadata.

`list` and `get` accept `include: { relatedTable: true }` for any relation declared on the table via `.relation()` in the schema — `hasMany`/`manyToMany` relations come back as arrays, `hasOne`/`belongsTo` as an object or `null`. Unknown relation names are rejected with a `400`. When the table has no relations, `include` is not part of the input schema.

`create`/`update` map common Postgres constraint violations to clean errors instead of a raw 500: unique/foreign-key violations → `409 CONFLICT`, not-null/check violations → `400 BAD_REQUEST`. `update`/`delete` on a row that doesn't exist → `404 NOT_FOUND`. `update` with an empty `data` object → `400 BAD_REQUEST`. Unrecognized DB errors still surface as a generic `500` with no internal details leaked.

`.resource()` and `.build()` validate configuration eagerly rather than failing at request time: using `"owner"` on any action without `ownerColumn` throws immediately when `.resource()` is called; if any resource action's permission requires a session (`"authenticated"`, `"admin"`, or `"owner"`) but `.auth()` was never called anywhere in the chain, `.build()` throws listing the offending `resource.action` names instead of surfacing a confusing 500 on the first request.

### Permissions

| Value             | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `"public"`        | No restriction (default)                                                  |
| `"authenticated"` | User must be signed in — calls `context.auth.api.getSession()` internally |
| `"admin"`         | User must have `role === "admin"` (requires Better Auth admin plugin)     |
| `"owner"`         | User must own the row — requires `ownerColumn`; not valid for `create`    |

When `create` is `"authenticated"` and `ownerColumn` is set, the current user's ID is automatically injected into the insert (`createMany` injects it into every row) — no need to pass it in the request.

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

---

## `.route(method, path, handler)`

Mounts a raw H3 route alongside `.procedure()`-defined RPC routes — for webhooks, custom REST endpoints, or anything that doesn't fit the oRPC shape. `handler` receives the H3 `event` and the same `context` (`headers`, `db`, `auth`) available in procedure handlers. Registered before `/rpc/**`, so it takes precedence on overlapping paths.

```ts
.route("post", "/webhooks/stripe", async (event, { db }) => {
  const body = await event.req.json();
  // ...
  return new Response("ok");
})
```

---

## `.build(): BuiltOuter`

Seals the router and constructs the HTTP server. Returns a `BuiltOuter` with:

- `handle(request: Request): Promise<Response>` — fetch-compatible handler
- `migrator` — Kysely `Migrator` instance (see Migrations)
- `client(headers?)` — in-process `RouterClient<TRouter>` (oRPC's `createRouterClient`) that calls procedures directly, skipping HTTP and the oRPC wire protocol. For SSR (Server Components, server functions) where Outer runs in the same process as the frontend. `headers` is a `Headers` or a `() => Headers | Promise<Headers>` (evaluated per call — pass the framework's request-headers accessor so permissions and `context.auth` see the caller's session); defaults to empty headers.

```ts
// e.g. Next.js Server Component
import { headers } from "next/headers";
const api = outer.client(() => headers());
const posts = await api.post.list({});
```

---

## HTTP routes

| Method | Path            | Handler                                                                       |
| ------ | --------------- | ----------------------------------------------------------------------------- |
| `GET`  | `/openapi.json` | OpenAPI 3.x spec (only mounted when `.openapi({ enabled: true })` was called) |
| `ALL`  | `/api/auth/**`  | Better Auth handler (only mounted when `.auth()` was called)                  |
| `ALL`  | `/rpc/**`       | oRPC handler (prefix `/rpc`)                                                  |
| `ALL`  | `/rest/**`      | Plain-JSON OpenAPI handler (only mounted when `.openapi()` was called)        |

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
};
```

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

`text` · `varchar` · `integer` · `serial` · `boolean` · `timestamp` · `jsonb` · `uuid`

### Column modifiers

`.primaryKey()` · `.unique()` · `.nullable()` · `.default(expr: string)` · `.references(table, column)`

`timestamp` maps to `timestamptz` in DDL.

### `timestamps(t)`

Returns `createdAt` and `updatedAt` (`timestamp`, default `CURRENT_TIMESTAMP`) to spread into a table definition:

```ts
.table("todo", (t) => ({
  id: t.text().primaryKey(),
  title: t.text(),
  ...timestamps(t),
}))
```

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

**Up** — creates new tables, adds new columns, drops removed columns.  
**Down** — reverses: drops added tables/columns, restores dropped ones.

Type changes on existing columns are not handled automatically — use `context.db` directly for those.

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
- `create`/`createMany` inputs omit serial primary keys, columns with `.default()`, and the resource's `ownerColumn` (auto-filled from the session); nullable columns are optional.
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

- **Admin dashboard/UI** — comparable to PocketBase's dashboard or Supabase Studio. Should expose: table data browser with CRUD, user/session management, and migration status. Planned as a separate `outer-admin` package served at `/admin` when enabled.

Serverless/edge support (Vercel Functions, Cloudflare Workers) is no longer blocked — `db: { dialect, kind }` (see "Custom dialects" above) lets you swap PGlite for a network-attached Postgres or a `"sqlite"`-family dialect, with working, verified templates for both (`templates/cloudflare`, Durable Objects; `templates/vercel-neon`, Neon Postgres). `mysql`/`mssql` `kind`s still aren't implemented (Kysely ships dialects for both, but Outer's DDL generation and error mapping don't cover them).

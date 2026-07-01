# Outer — Specification

Outer is a batteries-included TypeScript backend framework built on PGlite, Kysely, oRPC, and Better Auth. It exposes a builder-chain API that produces a fetch-compatible HTTP handler.

---

## Builder chain

```ts
const server = new Outer({ name: "My API", baseUrl: "http://localhost:3000" })
  .schema(v1_0)
  .schema(v1_1)        // each call adds a migration step and updates the DB type
  .auth({ secret: process.env.AUTH_SECRET! })
  .middleware(...)
  .procedure("user.me", (base) => base.handler(...))
  .build();

await server.migrator.migrateToLatest();
serve({ fetch: (req) => server.handle(req) });
```

Order matters: `.schema()` → `.middleware()` → `.procedure()` → `.build()`. `.auth()` can appear anywhere in the chain.

---

## `new Outer(params?)`

| Param                        | Type                              | Default                      | Description                                              |
| ---------------------------- | --------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `name`                       | `string`                          | `"Outer API"`                | API title in OpenAPI spec                                |
| `baseUrl`                    | `string`                          | —                            | Passed to Better Auth as `baseURL` when `.auth()` is called |
| `db.dataDir`                 | `string`                          | `<cwd>/.outer/pglite`        | PGlite data directory (created if missing)               |

---

## `.auth(config)`

Enables Better Auth and mounts `/api/auth/**`. Must be called before `.build()`. Can appear anywhere in the chain. Returns a new `Outer` whose `context.auth` type is narrowed to required (non-optional) for everything chained after this call (like `.middleware()`'s `next({ context })`). When `.auth()` is not called, `context.auth` is `undefined` and `/api/auth/**` is not mounted — resource permissions other than `"public"` will throw a configuration error.

`config` is `Omit<BetterAuthOptions, "database" | "baseURL"> & { secret: string }` — every Better Auth option (`plugins`, `emailAndPassword`, `trustedOrigins`, etc.) is accepted directly, with `secret` made required. `database` and `baseURL` are owned by Outer (`database` is wired to the internal PGlite dialect; `baseURL` comes from `new Outer({ baseUrl })`) and cannot be overridden here.

Outer's core does not set any Better Auth defaults (no default plugins, no default email options) — configure everything explicitly.

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

Auto-generates five CRUD procedures for a schema table. `name` must match a table defined in the last `.schema()` call.

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
// Registers: post.list, post.get, post.create, post.update, post.delete
```

| Procedure        | Input                              | Output         | Description                         |
| ---------------- | ---------------------------------- | -------------- | ----------------------------------- |
| `{name}.list`    | —                                  | `Row[]`        | `SELECT *`                          |
| `{name}.get`     | `{ <pk>: ... }`                    | `Row \| null`  | Fetch by primary key                |
| `{name}.create`  | Row minus serial PK, defaults, and `ownerColumn` | `Row` | `INSERT ... RETURNING *`  |
| `{name}.update`  | `{ where: { <pk> }, data: Partial<createInput> }` | `Row` | `UPDATE ... RETURNING *`  |
| `{name}.delete`  | `{ <pk>: ... }`                    | `Row`          | `DELETE ... RETURNING *`            |

Input types are derived from column definitions at build time. `serial` primary key columns, columns with `.default()`, and `ownerColumn` are omitted from create input.

### Permissions

| Value           | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `"public"`      | No restriction (default)                                                             |
| `"authenticated"` | User must be signed in — calls `context.auth.api.getSession()` internally          |
| `"admin"`       | User must have `role === "admin"` (requires Better Auth admin plugin)                |
| `"owner"`       | User must own the row — requires `ownerColumn`; not valid for `list` or `create`    |

When `create` is `"authenticated"` and `ownerColumn` is set, the current user's ID is automatically injected into the insert — no need to pass it in the request.

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

## `.build(): BuiltOuter`

Seals the router and constructs the HTTP server. Returns a `BuiltOuter` with:

- `handle(request: Request): Promise<Response>` — fetch-compatible handler
- `migrator` — Kysely `Migrator` instance (see Migrations)

---

## HTTP routes

| Method | Path            | Handler                                        |
| ------ | --------------- | ---------------------------------------------- |
| `GET`  | `/`             | Returns `"Outer"`                              |
| `GET`  | `/openapi.json` | OpenAPI 3.x spec (title + version from schema) |
| `ALL`  | `/api/auth/**`  | Better Auth handler (only mounted when `.auth()` was called) |
| `ALL`  | `/rpc/**`       | oRPC handler (prefix `/rpc`)                   |

---

## Embedding in a host framework

`BuiltOuter.handle(request: Request): Promise<Response>` is a plain Fetch API handler, so Outer mounts as the server entry for any framework that speaks `fetch` — Nitro, Hono, H3, Next.js API Routes, Cloudflare Workers, etc. Export whatever shape the host expects and delegate to `outer.handle`:

```ts
// e.g. Nitro server entry (see templates/nitro-ilha)
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

### Relation kinds

`hasMany` · `hasOne` · `belongsTo` · `manyToMany`

### Type inference

`SchemaResult<T>["_db"]` is the fully inferred Kysely database type — `{ [tableName]: { [column]: TSType } }`. Nullable columns become `TSType | null | undefined`.

---

## Migrations

```ts
const { error, results } = await server.migrator.migrateToLatest();
```

Uses a custom `SchemaMigrationProvider` that diffs consecutive schema versions. Each `schema("x.y.z")` call becomes one Kysely migration keyed by its version string. Migrations run in alphabetical version order.

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

The `Outer` instance exposes a `router` getter that returns the internal oRPC router. Use `typeof outer.router` for type-safe client generation:

```ts
// outer.types.ts
import type { RouterClient } from "@orpc/server";
import type { outer } from "./src/index.js";

export type AppRouter = typeof outer.router;
export type AppClient = RouterClient<AppRouter>;
```

The entry file must export the `outer` instance as a named export (e.g. `export const outer = new Outer(...).build()`). Calling `.build()` returns a `BuiltOuter`; for type extraction call `.router` before `.build()`, or export the pre-build instance.

Outer's core has no CLI — write the file above by hand, or generate it with your own script if you want automation.

---

## OpenAPI

`GET /openapi.json` returns an OpenAPI 3.x document generated by `@orpc/openapi`. Title comes from `name` param, version from the last registered schema. Procedures with `.input(zodSchema)` / `.output(zodSchema)` are fully documented. Output schema is not inferred from handler return types — explicit `.output()` is required for response documentation.

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

### Next priority: Admin dashboard/UI

An embedded admin UI (comparable to PocketBase's dashboard or Supabase Studio) is the highest-priority missing feature. It should expose: table data browser with CRUD, user/session management, and migration status. Planned as a separate `outer-admin` package served at `/admin` when enabled.

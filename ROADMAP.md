# Roadmap

What Outer ships today, and what comes next. For the full technical reference, see [SPEC.md](./SPEC.md).

## Shipped

### Outer (server + SDK)

- **Typed schema builder** — `schema()` with versioned migrations, enums, references, and auto-generated DDL (`postgres` and `sqlite` kinds)
- **Schema `extend()`** — derive the next version from a previous `SchemaResult`; columns merge (builder wins), relations dedupe
- **Schema version checks at chain time** — `.schema()` rejects non-ascending versions and numeric/lexicographic mismatches before migrate
- **Resources** — one `.resource()` call per table for typed `list` / `get` / `create` / `update` / `delete` with clean error mapping
- **Procedures, four surfaces** — define once with `.procedure()`, served as typed RPC, REST, an OpenAPI spec, and an MCP tool
- **Auth** — Better Auth mounted via `.auth()`, with email OTP, API keys (`@better-auth/api-key`), and session-aware `context.user`
- **Permissions** — `public` / `authenticated` / `owner` / `admin` per procedure, with automatic ownership checks
- **File uploads** — `.files()` over any storage (local disk, S3, R2, Vercel Blob), private by default, attachable to tables
- **Realtime** — async-generator procedures streamed over SSE with resumable delivery
- **Key/value store** — `context.kv` over any unstorage driver
- **Secrets** — `fromSchema()` env validation surfaced as `context.secrets`
- **Admin API** — `.admin()` exposes schema introspection, migration status, and table CRUD under `/rpc/_admin/**`, guarded by the admin role
- **Plugin system** — `.use(plugin)` for third-party and app procedures, routes, and middleware (`OuterPlugin` / `PluginResult`)
- **`.start()`** — `build()` + `migrateToLatest()` in one call; throws on migration error (`.build()` remains for manual control)
- **Phased `build()`** — internal `validateConfig` → `assembleRouter` → `mountServer`; shared context factory for HTTP and `client()`
- **Typed `onError` sources** — `ErrorSource` / `ErrorSourcesOf`; `rest` and `mcp` only when those features are enabled
- **Dev `baseUrl` default** — `http://localhost:${PORT || 3000}` outside production when `baseUrl` is omitted
- **Embedded Postgres** — `pglite()` with pgvector bundled, plus custom Kysely dialects for serverless (Cloudflare Durable Objects, Neon)
- **Typed client** — `@outerjs/sdk` infers the full router type from the server; no codegen
- **Templates** — `minimal`, `ilha`, `cloudflare`, `vercel-neon`, ready to clone with `giget` (self-hosted templates use `.start()`)

### Outer Hub ([hub.outer.now](https://hub.outer.now))

- **Instance manager** — add, edit, and remove instances with a connection test on add and live health indicators; everything stays in your browser's localStorage
- **Auth** — email OTP sign-in against the instance's own auth, plus sign-out
- **Dashboard** — tables, record counts, schema versions, and migration status at a glance
- **Table browser** — sort, search, and filter any table; schema-driven forms for create, edit, and delete (enums as selects, multi-enums, switches, date pickers, FK links)
- **Storage browser** — preview, rename, download, and delete uploads from `.files()`
- **API tokens** — create and revoke real Better Auth API keys for MCP and other headless clients
- **API reference** — embedded Scalar explorer for the instance's `/openapi.json`
- **Connection-error handling** — a clear recovery screen (retry / fix URL) when an instance is unreachable
- **E2E coverage** — Playwright suite (auth + table CRUD) running in CI against a real instance (fixture builds monorepo `packages/server`)

## Next

### Outer

- **Typed vector columns** — first-class `vector` support in `schema()`, typed through to queries (pgvector already ships with `pglite()`; today vector columns are raw SQL)
- **npm releases** — publish `@outerjs/server` and `@outerjs/sdk` to npm proper (currently pkg.pr.new builds)
- **More SQL kinds** — `mysql` / `mssql` DDL generation and error mapping (Kysely dialects already exist)

### Outer Hub

- **File uploads from Hub** — upload straight from the storage browser
- **Bulk operations** — row selection, multi-delete, and CSV/JSON export in the table browser
- **User administration** — verify email and revoke sessions beyond raw `user` rows
- **Procedure runner** — invoke and test procedures without requiring `.openapi()` + Scalar
- **KV and secrets surfaces** — browse `context.kv` and inspect configured secrets
- **Realtime visibility** — see active connections and subscriptions
- **Polish** — loading feedback during navigation, FK hover previews, filter-context-preserving cross-table links

---

Something missing? [Open an issue](https://github.com/ilhajs/outer/issues) — the roadmap follows real usage.

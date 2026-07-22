# Outer on Cloudflare Workers (Durable Objects as the DB)

Outer's default database, [PGlite](https://pglite.dev), needs a persistent local filesystem — which Cloudflare Workers doesn't have. This template swaps it for a [Durable Object](https://developers.cloudflare.com/durable-objects/)'s own SQLite storage instead, via [`kysely-durable-objects`](https://github.com/jeffwilde/kysely-durable-objects), plugged in through Outer's `db: { dialect, kind }` escape hatch (see [SPEC.md → Custom dialects](https://github.com/ilhajs/outer/blob/main/SPEC.md#custom-dialects)). Same `.schema()`/`.resource()`/`.procedure()` API as every other Outer app — only where it's constructed and what backs it changes.

## How it fits together

- **`src/worker.ts`** — everything Workers-side, in one file:
  - `OuterDO`, a `DurableObject` subclass. `new Outer({ db: { dialect: new DurableObjectSqliteDialect(ctx.storage.sql), kind: "sqlite" } })` is built inside its constructor (it needs `ctx.storage.sql`, which only exists once the DO instance exists), then `ctx.blockConcurrencyWhile` runs migrations once before the DO serves its first request.
  - The default-exported `fetch` handler, which routes every request to one `OuterDO` instance (`idFromName("singleton")`) so there's a single consistent database, the DO equivalent of PGlite's one local data file. Swap that for per-tenant `idFromName(orgId)` routing if you want isolated databases per customer instead.
- **`src/schema.ts`** — the Outer schema (one `post` table, plus the `file` tables from `.files()`).
- **`wrangler.jsonc`** — declares the `OUTER_DO`, `OUTER_FILES` (R2), and `OUTER_KV` bindings and, critically, `"new_sqlite_classes"` (not `"new_classes"`) in `migrations` — that's what gives the DO SQLite storage (`ctx.storage.sql`) instead of the older KV-backed DO storage.

## Getting started

```bash
npm install
npx wrangler r2 bucket create outer-files    # backs `.files()` uploads; once per account
npx wrangler kv namespace create OUTER_KV    # backs `context.kv`; paste the printed id into wrangler.jsonc
npm run dev      # wrangler dev — local Workers runtime, DO SQLite included
```

`wrangler dev` simulates R2 and KV locally, so the bucket and namespace only have to exist before you deploy.

Open [http://localhost:8787/openapi.json](http://localhost:8787/openapi.json) to confirm it's up.

```bash
npm run deploy    # wrangler deploy — requires `wrangler login` first
```

## Scripts

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `npm run dev`    | `wrangler dev` — local Workers + Durable Objects runtime |
| `npm run deploy` | `wrangler deploy` — publish to your Cloudflare account   |
| `npm run types`  | Regenerate `worker-configuration.d.ts` from bindings     |

Run `npm run types` after changing `wrangler.jsonc`'s bindings — `worker-configuration.d.ts` (the `Env` type) is generated, not hand-maintained.

## File uploads

`schema().files({ attachTo: ["post"] })` adds the `file` metadata table and a `post_file` pivot to the DO's SQLite; `.files()` on the chain adds `file.upload` / `list` / `get` / `delete` / `attach` / `detach` plus `GET /files/:id`. Only metadata goes in the Durable Object — the bytes go to R2.

R2 plugs in through [unstorage](https://unstorage.unjs.io)'s Cloudflare R2 binding driver, so there's no per-service adapter code — `fromUnstorage()` wraps it into `OuterStorage`:

```ts
storage: fromUnstorage(
  createStorage({ driver: cloudflareR2BindingDriver({ binding: env.OUTER_FILES }) }),
);
```

Uploads travel the normal typed client (`client.file.upload({ file })`); oRPC switches the request to `multipart/form-data` on its own. Files are **private by default** — only the uploader can read or delete them, and the download route returns `404` to everyone else. Pass `permissions: { get: "public" }` to `.files()` for world-readable assets.

## Key/value store

`new Outer({ kv })` surfaces a key/value store as `context.kv`, backed by the `OUTER_KV` namespace through unstorage's Cloudflare KV binding driver. `OuterKV` is unstorage-shaped, so the storage instance passes straight through — no adapter:

```ts
kv: createStorage({ driver: cloudflareKVBindingDriver({ binding: env.OUTER_KV }) });
```

Read and write it from any procedure, with TTL in seconds — Cloudflare KV enforces a 60-second minimum, which the driver applies for you:

```ts
await context.kv?.setItem("session:42", data, { ttl: 3600 });
const data = await context.kv?.getItem("session:42");
```

## Known rough edges

- `@outerjs/server` statically imports PGlite (WASM) regardless of which `db` option you use, so it ends up in the Workers bundle unused — inflates the deploy by a few hundred KB gzipped. Fine under Cloudflare's size limits today, but real waste; tree-shaking that import out is open work upstream.
- `kysely-durable-objects` mirrors `@cloudflare/workers-types`' `SqlStorage` type instead of depending on it, so `worker.ts` casts `ctx.storage.sql as any` at the one call site where the two structurally diverge — a version-skew type-only issue, not a runtime concern.
- Column defaults you write via `.default("...")` in `schema.ts` must be SQLite-valid SQL (e.g. `CURRENT_TIMESTAMP`, not Postgres' `now()`) if you add any — see [SPEC.md → Custom dialects](https://github.com/ilhajs/outer/blob/main/SPEC.md#custom-dialects).

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [kysely-durable-objects](https://github.com/jeffwilde/kysely-durable-objects)
- [Durable Objects SQL storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)

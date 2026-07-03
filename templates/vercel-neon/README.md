# Outer on Vercel + Neon

PGlite needs a persistent local filesystem, which Vercel's serverless functions don't have. This template swaps it for [Neon](https://neon.tech) — real Postgres, reached over HTTP via [`kysely-neon`](https://github.com/kysely-org/kysely-neon) so there's no TCP connection pooling to manage across invocations — plugged in through Outer's `db: { dialect, kind }` escape hatch (see [SPEC.md → Custom dialects](https://github.com/ilhajs/outer/blob/main/SPEC.md#custom-dialects)).

Because Neon is real Postgres, `kind: "postgres"` is the exact same path the default embedded PGlite dialect uses — no DDL remapping, no different error-code handling, nothing dialect-specific to this template beyond swapping the `Dialect` object itself.

## How it fits together

- **`api/index.ts`** — the whole app in one file: schema, `Outer` instance (`db: { dialect: new NeonDialect({ neon: neon(process.env.DATABASE_URL) }), kind: "postgres" }`), and the Vercel Function itself — `export async function fetch(request: Request): Promise<Response>` that delegates to `outer.handle`.

  **The export must be named `fetch` (or `GET`/`POST`/etc.), not `export default`.** Vercel's Node.js Functions builder — in both `vercel dev` and production — only detects a file as a Web Handler if it has a named export matching an HTTP method or `fetch`; a bare `export default function handler(request: Request)` is _not_ detected as one, and silently falls back to treating the file as a legacy Node.js `(req, res)` handler instead. In that fallback, what your function receives isn't a real Fetch API `Request` at all — `.url` is a bare path, `.headers` is a plain object with no `.get()` — and since nothing in that code path ever calls `res.end()` on the underlying response, every request hangs forever rather than erroring. This is easy to trip over since `(request: Request) => Response` is genuinely valid and documented — it just has to be reachable via a named export, not `default`.

  Deliberately one file, not split across `api/` and `src/`: Vercel's Node.js Functions builder transpiles files individually rather than bundling the module graph, so a relative import to a sibling file can fail to resolve at runtime (`ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/app'`) even though it typechecks and builds fine locally. Keeping everything in `api/index.ts` sidesteps that entirely — there's nothing for it to fail to resolve. (`scripts/migrate.ts` importing _from_ `api/index.ts` is fine, since `scripts/` is never bundled as a Function in the first place — this constraint only bites Vercel's own bundler, not ordinary local scripts.)

- **`scripts/migrate.ts`** — runs `outer.migrator.migrateToLatest()` once, reusing the exact same `Outer` instance exported from `api/index.ts`.
- **`vercel.json`**'s `buildCommand: "npm run migrate"` runs that script automatically as part of every `vercel deploy` — once per deployment, before the new version goes live. No separate step, no webhook, works on every plan (Hobby included) unlike [Vercel's Account Webhooks](https://vercel.com/docs/webhooks), which need a Pro or Enterprise team. It's also strictly safer than a post-deploy webhook: since migrations run during the _build_, a failed migration fails the build and the previous good deployment stays live — a webhook fired after `deployment.succeeded` would mean broken-schema code is already serving traffic before you find out the migration failed.

  This also directly solves running migrations from inside the Function: a serverless deployment can have many concurrent instances, each with its own cold start, so triggering `migrateToLatest()` from the request path — even memoized per-instance — really means "once per instance," not "once per deployment." `buildCommand` genuinely runs once, before any instance exists.

- **`vercel.json`**'s `rewrites` sends every path to that one function, so `/openapi.json`, `/rpc/**`, etc. all reach it with the original path intact. `outputDirectory: "public"` points at the empty `public/` folder — this project has no static output, and an empty dedicated folder avoids accidentally serving source files as static assets, which pointing it at the project root would risk.

## Getting started

You'll need a Neon database first — either provision one directly at [neon.tech](https://neon.tech), or through [Vercel's Neon integration](https://vercel.com/marketplace/neon) if you want the connection string wired into your Vercel project automatically.

```bash
cp .env.example .env
# paste your Neon connection string into DATABASE_URL in .env

npm install
npm run migrate   # applies the schema to your Neon database — vercel dev doesn't run buildCommand
npm run dev       # vercel dev — requires `vercel login` first
```

Open [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) to confirm it's up.

```bash
npm run deploy   # vercel deploy --prod — buildCommand runs `npm run migrate` automatically
```

Set `DATABASE_URL` in your Vercel project's environment variables too — `.env` is only read locally by `vercel dev`/`npm run migrate`, and `buildCommand` needs `DATABASE_URL` available at build time (Vercel exposes project env vars to both build and runtime by default, so this should just work once it's set).

## Scripts

| Command           | Description                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`     | `vercel dev` — local dev server against Neon                                                                                                 |
| `npm run deploy`  | `vercel deploy --prod` — publish to production (runs migrations via `buildCommand`)                                                          |
| `npm run migrate` | Apply pending schema migrations to whatever `DATABASE_URL` points at — run manually for local dev; runs automatically during `vercel deploy` |

## Known rough edges

- `kysely-neon`'s HTTP driver doesn't support interactive transactions (`db.transaction()` throws) or streaming — Kysely's `Migrator` doesn't need either (DDL isn't wrapped transactionally on this dialect), so schema migrations work fine, but don't reach for `db.transaction()` in your own procedures on this path. If you need real transactions, use Neon's `Pool` + Kysely's core `PostgresDialect` over a WebSocket connection instead of `kysely-neon`.
- Function runtime is Node.js, not Edge — chosen deliberately to sidestep Edge's separate set of Node API restrictions for a first pass. Edge would likely work too (the HTTP driver has no Node-specific dependencies) but is unverified here.

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [kysely-neon](https://github.com/kysely-org/kysely-neon)
- [Neon serverless driver](https://neon.tech/docs/serverless/serverless-driver)

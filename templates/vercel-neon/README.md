# Outer on Vercel + Neon

PGlite needs a persistent local filesystem, which Vercel's serverless functions don't have. This template swaps it for [Neon](https://neon.tech) — real Postgres, reached over HTTP via [`kysely-neon`](https://github.com/kysely-org/kysely-neon) so there's no TCP connection pooling to manage across invocations — plugged in through Outer's `db: { dialect, kind }` escape hatch (see [SPEC.md → Custom dialects](https://github.com/ilhajs/outer/blob/main/SPEC.md#custom-dialects)).

Because Neon is real Postgres, `kind: "postgres"` is the exact same path the default embedded PGlite dialect uses — no DDL remapping, no different error-code handling, nothing dialect-specific to this template beyond swapping the `Dialect` object itself.

## How it fits together

- **`src/app.ts`** — builds the `Outer` instance once at module load (`db: { dialect: new NeonDialect({ neon: neon(process.env.DATABASE_URL) }), kind: "postgres" }`), then runs migrations via top-level `await` — once per cold start, not per-request, since they're idempotent and there's no reason to re-check them on a warm invocation.
- **`src/schema.ts`** — the Outer schema (one `post` table).
- **`api/index.ts`** — a single Vercel serverless function using the Web-standard `(request: Request) => Response` signature (no `@vercel/node` req/res adapter needed) that just delegates to `outer.handle`.
- **`vercel.json`** — rewrites every path to that one function, so `/openapi.json`, `/rpc/**`, etc. all reach it with the original path intact.

## Getting started

You'll need a Neon database first — either provision one directly at [neon.tech](https://neon.tech), or through [Vercel's Neon integration](https://vercel.com/marketplace/neon) if you want the connection string wired into your Vercel project automatically.

```bash
cp .env.example .env
# paste your Neon connection string into DATABASE_URL in .env

npm install
npm run dev    # vercel dev — requires `vercel login` first
```

Open [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) to confirm it's up.

```bash
npm run deploy   # vercel deploy --prod
```

Set `DATABASE_URL` in your Vercel project's environment variables too — `.env` is only read locally by `vercel dev`.

## Scripts

| Command          | Description                                    |
| ---------------- | ---------------------------------------------- |
| `npm run dev`    | `vercel dev` — local dev server against Neon   |
| `npm run deploy` | `vercel deploy --prod` — publish to production |

## Known rough edges

- `kysely-neon`'s HTTP driver doesn't support interactive transactions (`db.transaction()` throws) or streaming — Kysely's `Migrator` doesn't need either (DDL isn't wrapped transactionally on this dialect), so schema migrations work fine, but don't reach for `db.transaction()` in your own procedures on this path. If you need real transactions, use Neon's `Pool` + Kysely's core `PostgresDialect` over a WebSocket connection instead of `kysely-neon`.
- Function runtime is Node.js, not Edge — chosen deliberately to sidestep Edge's separate set of Node API restrictions for a first pass. Edge would likely work too (the HTTP driver has no Node-specific dependencies) but is unverified here.

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [kysely-neon](https://github.com/kysely-org/kysely-neon)
- [Neon serverless driver](https://neon.tech/docs/serverless/serverless-driver)

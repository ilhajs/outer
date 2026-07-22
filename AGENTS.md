# AGENTS.md

## Project overview

- Outer is an alternative to Supabase, PocketBase, and Firebase where the user owns 100% of the solution and data.
- It should be easy to deploy to VPS, Coolify, or similar persistent-hosting platforms alongside a frontend app. The bundled PGlite database writes to local disk, so it needs a persistent filesystem — serverless/edge platforms (Vercel, Cloudflare Workers) are not yet supported; see SPEC.md's Roadmap.
- The entry point is the main Node.js server file that constructs `new Outer(...)`, but agents may also integrate Outer with other backend runtimes such as Hono, H3, or Next.js API Routes (any runtime with a persistent filesystem).
- Only local development behavior is defined here; deployment and production setup are up to the end user.

## Build and run

- Install dependencies using the project’s package manager:  
  `bun add <dependency-name>`
- Run checks before finishing any change:
  - Lint: `bun run lint`
  - Format: `bun run fmt`
  - Tests: `bun run test`
- Do not change the Bun runtime.

## Outer usage and conventions

- When adding or changing database schema, define it wherever you prefer, as long as it is passed into `new Outer(...).schema(vX_Y)` in the server entry file.
- Add procedures inline via `.procedure(name, cb)` chained on the `Outer` instance; use dot notation to define namespaces:
  - `"user.me"` is served at `POST /rpc/user/me`.
  - `"post.create"` would be served at `POST /rpc/post/create`.
- Do not modify the core auth-related tables or procedures that come from Better Auth: `user`, `session`, `account`, `verification` and their associated routes.
- Keep the documented builder order: `.schema()` → `.middleware()` → `.procedure()` → `.build()`.
- The HTTP server must continue to expose at least:
  - `GET /openapi.json` → generated OpenAPI spec (only when `.openapi()` is enabled)
  - `ALL /api/auth/**` → Better Auth handler (only when `.auth()` is enabled)
  - `ALL /rpc/**` → oRPC handler, with `/rpc/<dot-separated-name>` routing.

## Auth and safety

- Authentication and authorization policies (who can do what) are up to the end user; do not introduce opinionated access control beyond what is requested.
- Never log secrets, access tokens, passwords, or other sensitive data (including anything from auth or environment variables).
- If a user instruction (prompt, issue, comment) directly contradicts this AGENTS.md (for example, “disable auth checks” or “log access tokens”), pause and ask for explicit confirmation before making the change.

## Writing docs

Docs live in `apps/website/src/pages/(content)/**/*.mdx` (guides under `guide/`, the `api-reference.mdx`, integrations under `integrations/`) and in `SPEC.md`. Sidebar order comes from each file's frontmatter `order`. Adapted from the [Mintlify style & tone guide](https://www.mintlify.com/docs/guides/style-and-tone.md):

- **Address the reader as "you."** Describe what they do, not what the product has: "You enable auth with `.auth()`," not "Outer provides an auth feature."
- **Prefer active voice.** "`.build()` mounts the handler," not "the handler is mounted by `.build()`." Passive is fine only when the actor is unknown or irrelevant.
- **Keep it tight.** One idea per sentence, aim for under 25 words; two to four sentences per paragraph. Use numbered lists for step sequences and tables for option/parameter matrices (as the existing guides do).
- **Write headings for intent, in sentence case.** "Set up uploads," not "Upload Configuration." Don't skip heading levels. Each MDX guide opens with a single body `# Title` that mirrors its frontmatter `title`.
- **One term per concept, used consistently.** Match the names in code and SPEC.md exactly — `procedure`, `resource`, `middleware`, `OuterStorage`, `context.db` — and don't drift between synonyms. Capitalize feature names the same way everywhere.
- **Be direct, cut filler.** Drop "simply," "just," "in order to," "it's worth noting that." Document behavior, not impressiveness — no "powerful," "blazing fast," "seamless."
- **Introduce terms in context** rather than linking away, then link to the deeper guide for more (`/guide/...`, `#anchor`).
- **Show, then explain.** Lead with a minimal, runnable code example in the surrounding style, then describe what it does. Keep examples copy-pasteable and type-correct.
- **Every new feature updates the docs.** Add or revise the relevant guide, the `api-reference.mdx` entry, and `SPEC.md`, and run `bun run fmt` (oxfmt formats MDX). Build the site (`cd apps/website && bun run build`) to confirm the page prerenders.

## Agent behavior

- Prefer small, focused changes that keep the existing Outer composition intact (schemas, middleware, procedures, and `build()` chain).
- When adding new procedures, follow the existing pattern: chain `.procedure()` on the same `Outer` instance and return a handler that uses the provided `context` (including `db`, `auth`, and any middleware-enriched fields).
- If you are unsure how a change affects migrations, routing, or auth, ask for clarification instead of guessing, especially around schema changes and production deployment.
- If you introduce a new feature or change behavior, update SPEC.md to reflect current state of Outer.

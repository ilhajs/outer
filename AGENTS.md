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

## Agent behavior

- Prefer small, focused changes that keep the existing Outer composition intact (schemas, middleware, procedures, and `build()` chain).
- When adding new procedures, follow the existing pattern: chain `.procedure()` on the same `Outer` instance and return a handler that uses the provided `context` (including `db`, `auth`, and any middleware-enriched fields).
- If you are unsure how a change affects migrations, routing, or auth, ask for clarification instead of guessing, especially around schema changes and production deployment.
- If you introduce a new feature or change behavior, update SPEC.md to reflect current state of Outer.

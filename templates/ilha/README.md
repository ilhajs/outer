# Outer + Nitro + Ilha

A full-stack starter: [Outer](https://github.com/ilhajs/outer) (schema, auth, RPC procedures) mounted as a [Nitro](https://nitro.build) server entry, with an [Ilha](https://ilha.build) + [Vite](https://vite.dev) frontend. Pages live in `src/pages/` and mount on the client via `@ilha/router`; the backend lives in `src/server.ts`.

## Requirements

- Node.js 20+

## Getting started

```bash
cp .env.example .env
```

Generate a real value for `NITRO_AUTH_SECRET` in `.env` (e.g. `openssl rand -base64 32`) — Better Auth refuses to start with the empty placeholder from `.env.example`. This step is required for both `dev` and `preview`/production; without it you'll see `You are using the default secret` at startup.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `npm run dev`     | Start the Vite + Nitro dev server |
| `npm run build`   | Type-check and build for prod     |
| `npm run preview` | Preview the production build      |

## Project layout

```text
src/
  server.ts    # Outer server entry — schema, auth, resources, procedures
  lib/
    schemas/   # Outer schema definitions
    outer.ts   # Type-safe client (@outerjs/sdk)
  pages/       # File-based routes (+layout, index, login, …)
  main.ts      # Client entry — mounts islands
  app.css      # Tailwind + Areia styles
```

The demo includes email-OTP sign-in and a `foo` procedure backed by Nitro's KV storage, plus [Areia](https://areia.ilha.build) UI components.

## File uploads

`src/server.ts` gets the whole upload surface from one chain call:

```ts
new Outer({ db: pglite(), storage: fromUnstorage(useStorage("fs")) })
  .schema(v1_1_0)   // schema(...).auth().files({ attachTo: ["todo"] })
  .auth({ ... })
  .files({ maxBytes: 10 * 1024 * 1024 })
```

That registers:

| Endpoint                                                 | What it does                                         |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `client.file.upload({ file, attach? })`                  | Stores the bytes, optionally attaching to a todo     |
| `client.file.list({ attachedTo? })`                      | The signed-in user's files, filterable by attachment |
| `client.file.get({ id })` / `client.file.delete({ id })` | Read / remove one file                               |
| `client.file.attach(...)` / `client.file.detach(...)`    | Link an existing file to a todo                      |
| `GET /files/:id`                                         | Serves the bytes to their owner                      |

Uploads go over the normal typed client — pass a `File` and oRPC switches the request to `multipart/form-data` on its own:

```ts
const { url } = await client.file.upload({ file: input.files[0] });
```

Files are **private by default**: only the uploader can read or delete them, and the download route returns `404` to everyone else. Pass `permissions: { get: "public" }` to `.files()` for avatars and other world-readable assets.

Bytes live in [unstorage](https://unstorage.unjs.io) under the `fs` mount configured in `vite.config.ts`; the `file` table (schema `1.1.0`) holds only metadata and ownership. Swapping `fs-lite` for the `s3` driver in that config is the only change needed to move uploads to object storage in production.

## Auth

`.auth()` resolves the session once per request, so `context.user` and `context.session` are available in every procedure and raw route with no `getSession` middleware. Procedures declare access inline:

```ts
.procedure("foo", (base) => base.handler(...), { permission: "authenticated" })
```

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [Ilha docs](https://ilha.build/docs)
- [Nitro docs](https://nitro.build/guide)

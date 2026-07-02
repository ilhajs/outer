# Ilha + Outer

A full-stack starter: [Outer](https://github.com/ilhajs/outer) (schema, auth, RPC procedures) mounted as a [Nitro](https://nitro.build) server entry, with an [Ilha](https://ilha.build) + [Vite](https://vite.dev) frontend. Pages live in `src/pages/` and mount on the client via `@ilha/router`; the backend lives in `src/server.ts`.

## Requirements

- [Bun](https://bun.sh) or Node.js 20+

## Getting started

```bash
cp .env.example .env
```

Generate a real value for `NITRO_AUTH_SECRET` in `.env` (e.g. `openssl rand -base64 32`) — Better Auth refuses to start with the empty placeholder from `.env.example`. This step is required for both `dev` and `preview`/production; without it you'll see `You are using the default secret` at startup.

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `bun run dev`     | Start the Vite + Nitro dev server |
| `bun run build`   | Type-check and build for prod     |
| `bun run preview` | Preview the production build      |

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

## Learn more

- [Outer's full API reference](https://github.com/ilhajs/outer/blob/main/SPEC.md)
- [Ilha docs](https://ilha.build/docs)
- [Nitro docs](https://nitro.build/guide)

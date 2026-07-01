# @outerjs/server

Outer's core — a batteries-included TypeScript backend framework built on [PGlite](https://pglite.dev), [Kysely](https://kysely.dev), [oRPC](https://orpc.unnoq.com), and [Better Auth](https://better-auth.com). A fluent builder chain produces a single fetch-compatible HTTP handler.

## Install

```bash
bun add @outerjs/server
```

## Usage

```ts
import { Outer, schema } from "@outerjs/server";

const v1_0 = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
  }))
  .build();

const outer = new Outer({ name: "My API", baseUrl: "http://localhost:3000" })
  .schema(v1_0)
  .auth({ secret: process.env.AUTH_SECRET! })
  .resource("post")
  .build();

await outer.migrator.migrateToLatest();
export default { fetch: (req: Request) => outer.handle(req) };
```

See [SPEC.md](../../SPEC.md) for the full API reference.

## License

MIT

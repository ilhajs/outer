# @outerjs/sdk

**The typed client for [Outer](https://github.com/ilhajs/outer) servers — no codegen, no drift.** `createClient<TRouter>()` returns a builder for an [oRPC](https://orpc.unnoq.com) client typed straight against your server's router, with an opt-in `.auth()` step that merges in a [Better Auth](https://better-auth.com) client. Rename a field on the server and every caller turns red before you ship.

## Install

```bash
bun add @outerjs/sdk
```

## Pick a client

| Client             | API                                                | When                                     |
| ------------------ | -------------------------------------------------- | ---------------------------------------- |
| Browser / remote   | `createClient` from this package                   | Separate frontend origin, scripts, SPAs  |
| Same process (SSR) | `BuiltOuter.client(headers?)` on `@outerjs/server` | Server Components, loaders — no HTTP hop |

Both share `InferRouter<typeof outer>` types. Full walkthrough: [Client guide](https://outer.now/getting-started/client).

## Usage

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

export const client = createClient<InferRouter<typeof outer>>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();

await client.user.me(); // typed RPC
await client.auth.signIn.email({ email, password }); // Better Auth client
```

`.build()` only includes what you enabled during the chain — there's no `.auth` unless you called `.auth()`.

## Cross-origin auth

When the Outer server is on a different origin than the frontend, pass `credentials: "include"` so the browser attaches the session cookie, and enable credentialed CORS on the server:

```ts
// client
createClient<Router>({ baseUrl, credentials: "include" }).auth().build();

// server — see https://outer.now/outer/server#cors
new Outer({ cors: { origins: ["https://app.example.com"], credentials: true } });
```

## Realtime

A procedure that yields (an async generator on the server) is consumed as an async iterable — the SDK handles the SSE transport:

```ts
for await (const event of await client.notifications.stream()) {
  console.log(event); // typed, streamed as the server yields
}
```

See [Realtime](https://outer.now/outer/realtime) on the server and [Client → Realtime](https://outer.now/getting-started/client#realtime) for the consumer side.

## Documentation

| Guide                 | URL                                              |
| --------------------- | ------------------------------------------------ |
| Client                | <https://outer.now/getting-started/client>       |
| Introduction          | <https://outer.now/getting-started/introduction> |
| `new Outer()`         | <https://outer.now/outer/server>                 |
| Procedures / OpenAPI  | <https://outer.now/outer/procedure>              |
| Auth / CORS           | <https://outer.now/outer/auth>                   |
| CORS / server options | <https://outer.now/outer/server#cors>            |

Machine-oriented detail remains in [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md).

## License

MIT

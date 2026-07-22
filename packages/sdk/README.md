# @outerjs/sdk

**The typed client for [Outer](https://github.com/ilhajs/outer) servers — no codegen, no drift.** `createClient<TRouter>()` returns a builder for an [oRPC](https://orpc.unnoq.com) client typed straight against your server's router, with an opt-in `.auth()` step that merges in a [Better Auth](https://better-auth.com) client. Rename a field on the server and every caller turns red before you ship.

## Install

```bash
bun add @outerjs/sdk
```

## Usage

Type the client with `InferRouter<typeof outer>` from your server — every `.procedure()`'s input, output, and errors flow to the frontend:

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

export const client = createClient<InferRouter<typeof outer>>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();

await client.user.me(); // typed RPC call
await client.auth.signIn.email({ email, password }); // Better Auth client
```

`.build()` only includes what you enabled during the chain — there's no `.auth` unless you called `.auth()`.

## Cross-origin auth

When the Outer server is on a different origin than the frontend, pass `credentials: "include"` so the browser attaches the session cookie, and enable credentialed CORS on the server:

```ts
// client
createClient<Router>({ baseUrl, credentials: "include" }).auth().build();

// server
new Outer({ cors: { origins: ["https://app.example.com"], credentials: true } });
```

## Realtime

A procedure that yields (an async generator on the server) is consumed as an async iterable — the SDK handles the SSE transport:

```ts
for await (const event of await client.notifications.stream()) {
  console.log(event); // typed, streamed as the server yields
}
```

## Documentation

Full reference in [SPEC.md](https://github.com/ilhajs/outer/blob/main/SPEC.md).

## License

MIT

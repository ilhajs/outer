# @outerjs/sdk

Type-safe client for [Outer](https://github.com/ilhajs/outer) servers. `createClient<TRouter>()` returns a builder for an [oRPC](https://orpc.unnoq.com) client typed against your server's router, with an opt-in `.auth()` step that merges in a [Better Auth](https://better-auth.com) client. Call `.build()` to get the final client — it only has the entries you enabled during the chain (no `.auth` unless `.auth()` was called).

## Install

```bash
bun add @outerjs/sdk
```

## Usage

```ts
import { createClient } from "@outerjs/sdk";
import type { InferRouter } from "@outerjs/server";
import type { outer } from "./server";

type Router = InferRouter<typeof outer>;

export const client = createClient<Router>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();

await client.user.me(); // typed RPC call
await client.auth.signIn.email({ email, password }); // Better Auth client
```

## License

MIT

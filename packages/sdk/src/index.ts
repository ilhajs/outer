import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient, AnyRouter } from "@orpc/server";
import { createAuthClient, type BetterAuthClientOptions } from "better-auth/client";

export type CreateClientParams = {
  /** Base URL of the Outer server, e.g. "http://localhost:3000". */
  baseUrl: string;
  /** Path the oRPC handler is mounted at. Defaults to `/rpc` (Outer's default). */
  rpcPath?: `/${string}`;
  /**
   * `RequestCredentials` for RPC and auth requests. Pass `"include"` when the
   * Outer server is on another origin so the browser attaches the session
   * cookie — pair with `new Outer({ cors: { origins, credentials: true } })`
   * on the server. Defaults to the platform default (`"same-origin"`).
   */
  credentials?: RequestCredentials;
};

export class OuterClientBuilder<
  TRouter extends AnyRouter,
  TExtra extends Record<string, unknown> = Record<never, never>,
> {
  private authOptions: BetterAuthClientOptions | undefined;
  private authEnabled = false;

  constructor(private readonly params: CreateClientParams) {}

  /** Enables Better Auth — merges an auth client instance in as `.auth` once `.build()` is called. */
  auth<Option extends BetterAuthClientOptions>(
    options?: Option,
  ): OuterClientBuilder<TRouter, TExtra & { auth: ReturnType<typeof createAuthClient<Option>> }> {
    this.authEnabled = true;
    this.authOptions = options;
    return this as unknown as OuterClientBuilder<
      TRouter,
      TExtra & { auth: ReturnType<typeof createAuthClient<Option>> }
    >;
  }

  /** Builds the final client — only the entries enabled during the chain (RPC calls, plus `.auth` if `.auth()` was called). */
  build(): RouterClient<TRouter> & TExtra {
    const { credentials } = this.params;
    const link = new RPCLink({
      origin: this.params.baseUrl,
      url: this.params.rpcPath ?? "/rpc",
      ...(credentials && {
        fetch: (url: string, init: RequestInit) => globalThis.fetch(url, { ...init, credentials }),
      }),
    });
    const rpc = createORPCClient<RouterClient<TRouter>>(link);

    if (!this.authEnabled) return rpc as RouterClient<TRouter> & TExtra;

    const auth = createAuthClient({
      baseURL: this.params.baseUrl,
      ...this.authOptions,
      ...(credentials && {
        fetchOptions: { credentials, ...this.authOptions?.fetchOptions },
      }),
    });

    // `rpc` is itself a Proxy whose `get` trap unconditionally returns a nested
    // RPC client for any string key (see @orpc/client's createORPCClient) — it
    // never consults own properties, so `Object.assign(rpc, { auth })` silently
    // does nothing and `.auth` would still resolve to an RPC call at path
    // ["auth"]. Wrap it in another Proxy that shadows just the `auth` key.
    const client = new Proxy(rpc as object, {
      get(target, prop, receiver) {
        if (prop === "auth") return auth;
        return Reflect.get(target, prop, receiver);
      },
    });

    return client as RouterClient<TRouter> & TExtra;
  }
}

/**
 * Creates a type-safe client builder for an Outer server: an oRPC client for
 * `TRouter` (use `InferRouter<typeof outer>` from `@outerjs/server`), with an
 * opt-in `.auth()` step that merges in a Better Auth client. Call `.build()`
 * to get the final client.
 */
export function createClient<TRouter extends AnyRouter>(
  params: CreateClientParams,
): OuterClientBuilder<TRouter> {
  return new OuterClientBuilder<TRouter>(params);
}

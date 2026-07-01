import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient, AnyRouter } from "@orpc/server";
import { createAuthClient, type BetterAuthClientOptions } from "better-auth/client";

export type CreateClientParams = {
  /** Base URL of the Outer server, e.g. "http://localhost:3000". */
  baseUrl: string;
  /** Path the oRPC handler is mounted at. Defaults to `/rpc` (Outer's default). */
  rpcPath?: `/${string}`;
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
    const link = new RPCLink({ origin: this.params.baseUrl, url: this.params.rpcPath ?? "/rpc" });
    const rpc = createORPCClient<RouterClient<TRouter>>(link);

    if (!this.authEnabled) return rpc as RouterClient<TRouter> & TExtra;

    const auth = createAuthClient({ baseURL: this.params.baseUrl, ...this.authOptions });
    return Object.assign(rpc, { auth }) as unknown as RouterClient<TRouter> & TExtra;
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

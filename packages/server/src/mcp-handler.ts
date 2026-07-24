import { onError, type Router } from "@orpc/server";
import type { H3, H3Event } from "h3";

import type { McpConfig, OuterRpcContext } from "./types";

/**
 * `orpc-mcp` and `@orpc/zod` are optional peer dependencies — only needed when
 * `.mcp()` is enabled, so they're loaded lazily on the first request.
 */
/**
 * Built at runtime so bundlers (esbuild/wrangler) can't statically resolve the
 * `import()` below. Without this, targets that don't install the optional
 * `orpc-mcp` peer — e.g. the Cloudflare Workers template — fail to build.
 */
const mcpFetchSpecifier = ["orpc", "mcp", "fetch"].join("-").replace("-fetch", "/fetch");

export async function loadMcpModules() {
  try {
    const [mcpFetch, orpcZod] = await Promise.all([
      import(/* @vite-ignore */ mcpFetchSpecifier),
      import("@orpc/zod"),
    ]);
    return {
      MCPHandler: (mcpFetch as { MCPHandler: any }).MCPHandler,
      ZodToJsonSchemaConverter: orpcZod.ZodToJsonSchemaConverter,
    };
  } catch (cause) {
    throw new Error(
      "`.mcp()` requires the optional peer dependencies `orpc-mcp` and `@orpc/zod`. Install them with: bun add orpc-mcp @orpc/zod",
      { cause },
    );
  }
}

export function mountMcpHandler<TDB>(opts: {
  server: H3;
  router: Router<OuterRpcContext<TDB>>;
  mcpConfig: McpConfig;
  name: string | undefined;
  version: string | undefined;
  contextFor: (event: H3Event) => Promise<OuterRpcContext<TDB>>;
  reportError: (error: unknown, request?: Request) => void;
}): H3 {
  const { router, mcpConfig, name, version, contextFor, reportError } = opts;
  let server = opts.server;
  const mcpPath = mcpConfig.path ?? "/mcp";
  let mcpModules: ReturnType<typeof loadMcpModules> | undefined;
  let mcpHandler: { handle: (req: Request, opts: any) => Promise<{ response?: Response }> };
  server = server.all(mcpPath, async (event) => {
    if (!mcpHandler) {
      const { MCPHandler, ZodToJsonSchemaConverter } = await (mcpModules ??= loadMcpModules());
      mcpHandler = new MCPHandler(router, {
        converters: [new ZodToJsonSchemaConverter()],
        serverInfo: {
          name: mcpConfig.serverInfo?.name ?? name ?? "Outer",
          version: mcpConfig.serverInfo?.version ?? version ?? "0.0.0",
        },
        ...(mcpConfig.instructions && { instructions: mcpConfig.instructions }),
        ...(mcpConfig.enableDnsRebindingProtection && {
          enableDnsRebindingProtection: true,
          allowedOrigins: mcpConfig.allowedOrigins,
          allowedHosts: mcpConfig.allowedHosts,
        }),
        interceptors: [onError((error) => reportError(error))],
      });
    }
    const { response } = await mcpHandler.handle(event.req, {
      prefix: mcpPath as `/${string}`,
      context: await contextFor(event),
    });
    return response ?? new Response("Not found", { status: 404 });
  });
  return server;
}

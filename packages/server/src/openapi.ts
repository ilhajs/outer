import type { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError, type Router } from "@orpc/server";
import type { H3, H3Event } from "h3";

import type { OuterRpcContext } from "./types";

/**
 * `@orpc/openapi` and `@orpc/zod` are optional peer dependencies — only needed
 * when `.openapi()` is enabled, so they're loaded lazily on the first request
 * to an OpenAPI route rather than imported at module load.
 */
export async function loadOpenApiModules() {
  try {
    const [openapi, openapiFetch, orpcZod] = await Promise.all([
      import("@orpc/openapi"),
      import("@orpc/openapi/fetch"),
      import("@orpc/zod"),
    ]);
    return {
      OpenAPIGenerator: openapi.OpenAPIGenerator,
      OpenAPIHandler: openapiFetch.OpenAPIHandler,
      ZodToJsonSchemaConverter: orpcZod.ZodToJsonSchemaConverter,
    };
  } catch (cause) {
    throw new Error(
      "`.openapi()` requires the optional peer dependencies `@orpc/openapi` and `@orpc/zod`. Install them with: bun add @orpc/openapi @orpc/zod",
      { cause },
    );
  }
}

export function mountOpenApiRoutes<TDB>(opts: {
  server: H3;
  router: Router<OuterRpcContext<TDB>>;
  name: string | undefined;
  baseUrl: string | undefined;
  version: string | undefined;
  contextFor: (event: H3Event) => Promise<OuterRpcContext<TDB>>;
  reportError: (error: unknown, request?: Request) => void;
}): H3 {
  const { router, name, baseUrl, version, contextFor, reportError } = opts;
  let server = opts.server;
  let modulesPromise: ReturnType<typeof loadOpenApiModules> | undefined;
  const modules = () => (modulesPromise ??= loadOpenApiModules());
  const restBase = `${baseUrl ?? ""}/rest`;
  server = server.get("/openapi.json", async () => {
    const { OpenAPIGenerator, ZodToJsonSchemaConverter } = await modules();
    const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
    return generator.generate(router, {
      base: {
        info: {
          title: name ?? "Outer API",
          version: version ?? "0.0.0",
        },
        servers: [{ url: restBase }],
      },
    });
  });

  // Plain-JSON REST surface matching the OpenAPI spec (the /rpc/** handler
  // speaks oRPC's own wire protocol, which spec-driven clients can't use).
  let openapiHandler: OpenAPIHandler<OuterRpcContext<TDB>> | undefined;
  server = server.all("/rest/**", async (event) => {
    openapiHandler ??= new (await modules()).OpenAPIHandler(router, {
      interceptors: [onError((error) => reportError(error))],
    });
    const { response } = await openapiHandler.handle(event.req, {
      prefix: "/rest",
      context: await contextFor(event),
    });
    return response;
  });
  return server;
}

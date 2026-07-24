import type { H3Event } from "h3";

import type { CorsConfig } from "./types";

/** Matches h3's `Middleware` signature (`next` may return a bare value or a Promise). */
export type H3Middleware = (
  event: H3Event,
  next: () => unknown | Promise<unknown | undefined>,
) => unknown | Promise<unknown | undefined>;

export function createCorsMiddleware(cors: CorsConfig): H3Middleware {
  return async (event, next) => {
    // Vary on every response (not just allowed origins) so shared caches
    // never serve an ACAO-bearing response to a different origin.
    event.res.headers.set("Vary", "Origin");
    const origin = event.req.headers.get("origin");
    // `"*"` matches every origin. The request origin is still echoed back
    // rather than sent literally, since browsers reject a wildcard
    // `Access-Control-Allow-Origin` whenever credentials are involved.
    if (origin && (cors.origins.includes("*") || cors.origins.includes(origin))) {
      event.res.headers.set("Access-Control-Allow-Origin", origin);
      if (cors.credentials) event.res.headers.set("Access-Control-Allow-Credentials", "true");
      event.res.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      event.res.headers.set(
        "Access-Control-Allow-Headers",
        event.req.headers.get("access-control-request-headers") ?? "content-type",
      );
      event.res.headers.set("Access-Control-Max-Age", "600");
    }
    // Short-circuit only real preflights, so custom OPTIONS routes still work
    if (event.req.method === "OPTIONS" && event.req.headers.has("access-control-request-method")) {
      event.res.status = 204;
      return "";
    }
    const result = await next();
    // H3 merges `event.res` headers into a returned `Response` only when it's
    // 2xx — re-apply them onto error responses (oRPC 4xx, auth 401s, ...) so
    // browsers can read the error instead of failing the whole fetch on CORS.
    if (result instanceof Response && !result.ok) {
      const merge = (target: Headers) => {
        for (const [name, value] of event.res.headers) {
          if (name === "set-cookie") target.append(name, value);
          else target.set(name, value);
        }
      };
      try {
        merge(result.headers);
      } catch {
        // immutable headers — rebuild the response
        const headers = new Headers(result.headers);
        merge(headers);
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers,
        });
      }
    }
    return result;
  };
}

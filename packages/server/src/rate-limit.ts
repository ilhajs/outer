import type { H3Event } from "h3";

import type { H3Middleware } from "./cors";
import type { OuterRpcContext, RateLimitConfig, RateLimitStore } from "./types";

/**
 * Fixed-window counter held in memory. Expired keys are swept on an interval
 * so a flood of one-off keys can't grow the map without bound.
 */
export function memoryRateLimitStore(sweepMs = 60_000): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, sweepMs);
  // Don't hold the process open just for the sweep.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      const existing = hits.get(key);
      if (!existing || existing.resetAt <= now) {
        const entry = { count: 1, resetAt: now + windowMs };
        hits.set(key, entry);
        return entry;
      }
      existing.count++;
      return existing;
    },
    dispose() {
      clearInterval(timer);
      hits.clear();
    },
  };
}

export function createRateLimitMiddleware(
  config: RateLimitConfig,
  store: RateLimitStore,
  contextFor: (event: H3Event) => Promise<OuterRpcContext>,
): H3Middleware {
  const guarded = (path: string) => path.startsWith("/rpc") || path.startsWith("/rest");
  return async (event, next) => {
    const path = new URL(event.req.url).pathname;
    // `/api/auth/**` is left alone — Better Auth rate-limits its own routes.
    if (!guarded(path)) return next();
    if (await config.skip?.(event)) return next();

    const user = (await contextFor(event)).user ?? null;
    const key = config.key
      ? await config.key(event, user)
      : (user?.id ??
        event.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        event.req.headers.get("x-real-ip") ??
        "unknown");

    const { count, resetAt } = await store.hit(key, config.windowMs);
    const remaining = Math.max(0, config.max - count);
    event.res.headers.set("RateLimit-Limit", String(config.max));
    event.res.headers.set("RateLimit-Remaining", String(remaining));
    event.res.headers.set("RateLimit-Reset", String(Math.ceil((resetAt - Date.now()) / 1000)));
    if (count > config.max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return new Response(JSON.stringify({ error: "Too many requests", retryAfter }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfter),
          "RateLimit-Limit": String(config.max),
          "RateLimit-Remaining": "0",
          "RateLimit-Reset": String(retryAfter),
        },
      });
    }
    return next();
  };
}

import { getClient } from "$lib/outer";
import type { Instance } from "$lib/store";
import type { AdminMeta } from "@outerjs/server";

/**
 * Single source of truth for `_admin.meta` per instance. Every loader used to
 * fetch meta independently, so one navigation hit the endpoint 2-3 times and
 * the sidebar/grid could briefly disagree. Requests are deduped while in
 * flight and cached briefly so loaders that run together share one response.
 */
const TTL_MS = 15_000;

type CacheEntry = { promise: Promise<AdminMeta>; at: number };

const cache = new Map<string, CacheEntry>();

export function fetchMeta(instance: Instance): Promise<AdminMeta> {
  const entry = cache.get(instance.url);
  if (entry && Date.now() - entry.at < TTL_MS) return entry.promise;

  const promise = getClient(instance.url)
    ._admin.meta()
    .then((meta) => meta as AdminMeta);
  cache.set(instance.url, { promise, at: Date.now() });
  // Failed fetches must not poison the cache — the retry should hit the network.
  promise.catch(() => cache.delete(instance.url));
  return promise;
}

/** Like `fetchMeta`, but resolves `null` when the instance is unreachable. */
export async function tryFetchMeta(instance: Instance): Promise<AdminMeta | null> {
  try {
    return await fetchMeta(instance);
  } catch {
    return null;
  }
}

/** Drop the cached meta for an instance (e.g. after its URL changes). */
export function invalidateMeta(url: string) {
  cache.delete(url);
}

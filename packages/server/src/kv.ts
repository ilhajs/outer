/**
 * A key/value store, surfaced as `context.kv`. Deliberately typed structurally
 * against [unstorage](https://unstorage.unjs.io)'s `Storage` — the slice apps
 * actually use — so core never imports unstorage and any unstorage instance
 * (Nitro's `useStorage()`, a bare `createStorage(...)`, a Cloudflare KV or
 * Vercel KV driver) assigns to it without an adapter.
 *
 * Unlike `OuterStorage` (a narrow byte store `.files()` calls internally), KV
 * has no internal consumer forcing a narrow contract, so it keeps unstorage's
 * full ergonomics: TTL via `setItem(key, value, { ttl })`, `getKeys`, prefixes.
 *
 * ```ts
 * await context.kv.setItem("session:42", data, { ttl: 3600 }); // seconds
 * const data = await context.kv.getItem<Session>("session:42");
 * ```
 */
export type OuterKV = {
  hasItem(key: string): Promise<boolean>;
  getItem<T = unknown>(key: string): Promise<T | null>;
  getItemRaw(key: string): Promise<unknown>;
  setItem(key: string, value: unknown, opts?: { ttl?: number }): Promise<void>;
  setItemRaw(key: string, value: unknown, opts?: { ttl?: number }): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(base?: string): Promise<string[]>;
  clear(base?: string): Promise<void>;
};

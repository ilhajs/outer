import type { OuterKV } from "./kv";
import type { OuterSecrets } from "./secrets";
import type { OuterStorage } from "./storage";
import type { OuterAuth, OuterDB, OuterRpcContext, SessionUser, UserSession } from "./types";

export type ContextFactoryParts<TDB> = {
  typedDb: OuterDB<TDB>;
  auth: OuterAuth | undefined;
  storage: OuterStorage | undefined;
  secrets: OuterSecrets<any> | undefined;
  kv: OuterKV | undefined;
};

/**
 * Builds the per-request context factory used by the HTTP path and
 * `BuiltOuter.client()`. Session resolution lives in one place so both paths
 * stay identical when the context shape changes.
 */
export function createContextFactory<TDB>(
  parts: ContextFactoryParts<TDB>,
): (headers: Headers) => Promise<OuterRpcContext<TDB>> {
  const { typedDb, auth, storage, secrets, kv } = parts;
  return async (headers: Headers): Promise<OuterRpcContext<TDB>> => {
    const base = {
      headers,
      db: typedDb,
      ...(storage && { storage }),
      ...(secrets && { secrets }),
      ...(kv && { kv }),
    } as OuterRpcContext<TDB>;
    if (!auth) return { ...base, user: null, session: null };
    const resolved = await auth.api.getSession({ headers }).catch(() => null);
    return {
      ...base,
      auth,
      user: (resolved?.user as SessionUser | undefined) ?? null,
      session: (resolved?.session as UserSession | undefined) ?? null,
    };
  };
}

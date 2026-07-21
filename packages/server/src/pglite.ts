import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { live, type PGliteWithLive } from "@electric-sql/pglite/live";
import { Dialect, PGliteDialect } from "kysely";

import { liveIterable, type LiveProvider } from "./live";

export type PGliteDbConfig = {
  /** Defaults to `<cwd>/.outer/pglite` (created if missing). Pass a `memory://` URL for an in-memory instance. */
  dataDir?: string;
};

export type PGliteDb = {
  dialect: Dialect;
  kind: "postgres";
  /** Backs `context.db.query.<table>.live()` — see `.live()` in SPEC.md. */
  live: LiveProvider;
  /**
   * The underlying PGlite client. Kysely's `PGliteDialect` keeps its own
   * reference private, so this is the only handle to the extensions Outer
   * loads (`live`, `vector`) for anything the query builder doesn't cover.
   */
  client: PGliteWithLive;
};

/**
 * Embedded, zero-infra Postgres via PGlite — the default most Outer apps want. Pass the result as `new Outer({ db: pglite() })`.
 *
 * The `live` (reactive queries) and `vector` (pgvector) extensions are enabled by default.
 */
export function pglite(config: PGliteDbConfig = {}): PGliteDb {
  const dataDir = config.dataDir ?? path.join(process.cwd(), ".outer", "pglite");
  if (!dataDir.startsWith("memory://")) {
    mkdirSync(dataDir, { recursive: true });
  }
  // The extensions object is what adds `.live`, but PGlite's constructor type
  // doesn't reflect it — hence the cast to the namespace-carrying type.
  const client = new PGlite({ dataDir, extensions: { live, vector } }) as unknown as PGliteWithLive;
  // Queued before any dialect query, so `vector` types are available to migrations.
  void client.exec("CREATE EXTENSION IF NOT EXISTS vector;");

  return {
    dialect: new PGliteDialect({ pglite: client }),
    kind: "postgres",
    live: pgliteLive(client),
    client,
  };
}

/** Adapts PGlite's `live` extension to the dialect-agnostic `LiveProvider` contract. */
export function pgliteLive(client: PGliteWithLive): LiveProvider {
  return {
    subscribe: ({ sql, parameters, signal }) =>
      liveIterable<Record<string, unknown>>(async (emit) => {
        const subscription = await client.live.query<Record<string, unknown>>(
          sql,
          [...parameters],
          (results) => emit(results.rows),
        );
        // The initial result set is returned rather than pushed to the callback.
        emit(subscription.initialResults.rows);
        return () => subscription.unsubscribe();
      }, signal),
  };
}

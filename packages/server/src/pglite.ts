import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { live } from "@electric-sql/pglite/live";
import { Dialect, PGliteDialect } from "kysely";

export type PGliteDbConfig = {
  /** Defaults to `<cwd>/.outer/pglite` (created if missing). Pass a `memory://` URL for an in-memory instance. */
  dataDir?: string;
};

/**
 * Embedded, zero-infra Postgres via PGlite — the default most Outer apps want. Pass the result as `new Outer({ db: pglite() })`.
 *
 * The `live` (reactive queries) and `vector` (pgvector) extensions are enabled by default.
 */
export function pglite(config: PGliteDbConfig = {}): { dialect: Dialect; kind: "postgres" } {
  const dataDir = config.dataDir ?? path.join(process.cwd(), ".outer", "pglite");
  if (!dataDir.startsWith("memory://")) {
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite({ dataDir, extensions: { live, vector } });
  // Queued before any dialect query, so `vector` types are available to migrations.
  void client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  return { dialect: new PGliteDialect({ pglite: client }), kind: "postgres" };
}

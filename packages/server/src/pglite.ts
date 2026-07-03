import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { Dialect, PGliteDialect } from "kysely";

export type PGliteDbConfig = {
  /** Defaults to `<cwd>/.outer/pglite` (created if missing). Pass a `memory://` URL for an in-memory instance. */
  dataDir?: string;
};

/** Embedded, zero-infra Postgres via PGlite — the default most Outer apps want. Pass the result as `new Outer({ db: pgliteDb() })`. */
export function pgliteDb(config: PGliteDbConfig = {}): { dialect: Dialect; kind: "postgres" } {
  const dataDir = config.dataDir ?? path.join(process.cwd(), ".outer", "pglite");
  if (!dataDir.startsWith("memory://")) {
    mkdirSync(dataDir, { recursive: true });
  }
  return { dialect: new PGliteDialect({ pglite: new PGlite({ dataDir }) }), kind: "postgres" };
}

import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";

import { createMigrator } from "./migrator";
import type { SchemaResult } from "./schema";
import type { AuthConfig } from "./types";

/**
 * Better Auth defaults to scrypt, which is deliberately expensive — a single
 * sign-up dominates the runtime of any test that needs a session, and dozens of
 * them across a `--parallel` suite is what makes CI hooks time out.
 *
 * These tests are asserting Outer's behavior, not Better Auth's KDF, so swap in
 * a trivial hash. Never use this outside tests.
 */
export const fastPasswordHashing = {
  enabled: true,
  password: {
    hash: async (password: string) => `plain:${password}`,
    verify: async ({ hash, password }: { hash: string; password: string }) =>
      hash === `plain:${password}`,
  },
} satisfies AuthConfig["emailAndPassword"];

/** Standard test auth config: cheap hashing plus a secret long enough for Better Auth. */
export const testAuth = (extra: Partial<AuthConfig> = {}): AuthConfig => ({
  secret: "test-secret-that-is-long-enough",
  emailAndPassword: fastPasswordHashing,
  ...extra,
});

/**
 * Booting a PGlite instance costs ~1s (WASM init + `initdb`), which dominates
 * every suite here — running the migrations on top is only ~40ms. So each
 * distinct schema is booted and migrated exactly once, dumped, and every test
 * app is restored from that dump instead: ~200ms, and still a completely
 * separate database, so tests stay isolated.
 *
 * ```ts
 * const db = testDb([v1_0_0]);
 * const app = new Outer({ db: await db() }).schema(v1_0_0).build();
 * ```
 *
 * Don't use this to test the migrator itself — the restored database already
 * has every migration applied.
 */
export function testDb(schemas: SchemaResult<any>[]) {
  let dump: Promise<Blob> | undefined;

  const snapshot = () =>
    (dump ??= (async () => {
      const pglite = new PGlite();
      const db = new Kysely<any>({ dialect: new PGliteDialect({ pglite }) });
      const { error } = await createMigrator({ db, schemas, kind: "postgres" }).migrateToLatest();
      if (error) throw error;
      // "none" — the dump is only held in memory, so skip the compression cost
      return pglite.dumpDataDir("none") as Promise<Blob>;
    })());

  return async () => ({
    dialect: new PGliteDialect({ pglite: new PGlite({ loadDataDir: await snapshot() }) }),
    kind: "postgres" as const,
  });
}

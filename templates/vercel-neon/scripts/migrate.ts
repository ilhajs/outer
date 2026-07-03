import { outer } from "../api/index.ts";

// runs against whichever DATABASE_URL is in scope — see README
const { error, results } = await outer.migrator.migrateToLatest();

if (error) {
  console.error(error);
  process.exit(1);
}

console.info(
  results?.length
    ? `[Outer] ${results.length} migrations applied`
    : "[Outer] No migrations to apply",
);

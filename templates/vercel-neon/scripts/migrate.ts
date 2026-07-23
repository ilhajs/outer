import { env, outer } from "../api/index.ts";

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

// Seed the single admin account so `.admin()` (and Outer Hub) are usable out of the box.
// Idempotent — re-running promotes an existing user with this email instead of duplicating.
if (env.ADMIN_EMAIL) {
  await outer.db
    .insertInto("user")
    .values({
      id: crypto.randomUUID(),
      name: "Admin",
      email: env.ADMIN_EMAIL,
      emailVerified: true,
      role: "admin",
      banned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflict((oc) => oc.column("email").doUpdateSet({ role: "admin" }))
    .execute();
  console.info("[Outer] Admin account seeded");
}

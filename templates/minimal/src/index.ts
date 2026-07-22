import { existsSync } from "node:fs";

import { Outer, type InferRouter } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { fromSchema } from "@outerjs/server/secrets";
import { fromUnstorage } from "@outerjs/server/storage";
import { emailOTP } from "better-auth/plugins";
import { serve } from "srvx";
import { createStorage } from "unstorage";
import fsLite from "unstorage/drivers/fs-lite";
import { z } from "zod";

import { v1_0_0 } from "./schema";

// TODO: Copy .env.example to .env and set AUTH_SECRET in production
// Node doesn't read .env on its own (Bun/Deno do); optional chaining skips runtimes that auto-load or lack loadEnvFile
if (existsSync(".env")) process.loadEnvFile?.(".env");

// One schema validates the env and stays the single source of truth: `fromSchema` parses
// once, throws on bad config, and hands back a typed accessor. `secrets.get("KEY")` returns
// the parsed value (defaults + transforms applied), typed per key; pass `secrets` to
// `new Outer({ secrets })` too, so procedures read the same validated values via `context.secrets`.
const secrets = fromSchema(
  z.object({
    PORT: z.coerce.number().default(3000),
    BASE_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().default("dev-only-secret"),
    // seeded admin account — signs in via email OTP only (no password); leave unset to skip seeding
    ADMIN_EMAIL: z.email().optional(),
    // namespaces this instance's auth cookies — set a unique value per instance so several
    // Outer instances on the same host (localhost ports share one cookie jar) keep separate sessions
    COOKIE_PREFIX: z.string().default("outer"),
    // comma-separated browser origins allowed cross-origin (e.g. an admin dashboard); the default is the hosted hub
    CORS_ORIGINS: z
      .string()
      .default("https://hub.outer.now")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
  }),
  process.env,
);

const outer = new Outer({
  name: "Outer",
  db: pglite(),
  baseUrl: secrets.get("BASE_URL"),
  // credentials lets browsers send the session cookie cross-origin — pair with `credentials: "include"` on the client
  cors: { origins: secrets.get("CORS_ORIGINS"), credentials: true },
  // Where uploaded bytes live. `fs-lite` writes next to the PGlite data dir; swap the
  // driver for `s3` (or use `fromS3`) in production and nothing below changes.
  storage: fromUnstorage(createStorage({ driver: fsLite({ base: ".outer/files" }) })),
  // Surfaced as `context.secrets` — read the same validated values in any procedure
  secrets,
})
  .schema(v1_0_0)
  .auth({
    secret: secrets.get("AUTH_SECRET"),
    advanced: { cookiePrefix: secrets.get("COOKIE_PREFIX") },
    emailAndPassword: { enabled: true },
    user: {
      // `input: false` blocks signups from setting their own role — only the seed (or an admin) can
      additionalFields: { role: { type: "string", defaultValue: "user", input: false } },
    },
    plugins: [
      emailOTP({
        // OTP is sign-in only: it can't create accounts, so the seeded admin stays the only admin
        disableSignUp: true,
        async sendVerificationOTP({ email, otp }) {
          console.log(">>>OTP", { email, otp });
        },
      }),
    ],
  })
  .openapi()
  .admin()
  // Adds file.upload / list / get / delete / attach / detach plus GET /files/:id.
  // Files default to private: only the uploader can read or delete them.
  .files({ maxBytes: 10 * 1024 * 1024 })
  // `readonly` keeps the DB-managed timestamps out of the create/update input,
  // so a client can't spoof them (`updatedAt` is auto-touched on update anyway).
  .resource("post", { readonly: ["createdAt", "updatedAt"] })
  .procedure("post.count", (base) =>
    base.output(z.object({ count: z.number() })).handler(async ({ context }) => {
      const rows = await context.db
        .selectFrom("post")
        .select(context.db.fn.countAll().as("count"))
        .execute();
      return { count: Number(rows[0]?.count ?? 0) };
    }),
  )
  .build();

const { error, results } = await outer.migrator.migrateToLatest();

if (error) {
  console.error(error);
} else {
  console.info(
    results?.length
      ? `[Outer] ${results.length} migrations applied`
      : "[Outer] No migrations to apply",
  );
}

// Seed the single admin account: no password, so email OTP is its only sign-in path.
// Idempotent — re-running promotes an existing user with this email instead of duplicating.
const adminEmail = secrets.get("ADMIN_EMAIL");
if (!error && adminEmail) {
  await outer.db
    .insertInto("user")
    .values({
      id: crypto.randomUUID(),
      name: "Admin",
      email: adminEmail,
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

export type Router = InferRouter<typeof outer>;

// swap for Bun.serve/Deno.serve/etc — outer.handle is a plain Fetch handler
serve({
  fetch: (req) => outer.handle(req),
  port: secrets.get("PORT"),
});

// Release the database (and the embedded PGlite with it) on a deploy restart,
// so the data directory is left in a clean state.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await outer.close();
    process.exit(0);
  });
}

import { v1_0_0 } from "$lib/schemas/v1-0-0";
import { Outer, type InferRouter } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { fromSchema } from "@outerjs/server/secrets";
import { fromUnstorage } from "@outerjs/server/storage";
import { admin, emailOTP } from "better-auth/plugins";
import { useRuntimeConfig } from "nitro/runtime-config";
import { useStorage } from "nitro/storage";
import { runTask } from "nitro/task";
import { z } from "zod";

const runtimeConfig = useRuntimeConfig();

// TODO: Set NITRO_AUTH_SECRET and VITE_APP_URL in production — the fallbacks are for local development only
// One schema validates the env and stays the single source of truth: `fromSchema` parses
// once, throws on bad config, and hands back a typed accessor. Pass `secrets` to
// `new Outer({ secrets })` so procedures read the same values via `context.secrets`.
// Nitro maps `NITRO_AUTH_SECRET` → `runtimeConfig.authSecret`; Vite injects `VITE_APP_URL`.
const secrets = fromSchema(
  z.object({
    VITE_APP_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().min(1).default("dev-only-secret"),
    // seeded admin account — signs in via email OTP; leave unset to skip seeding
    ADMIN_EMAIL: z.email().optional(),
    // namespaces this instance's auth cookies — set a unique value per instance so several
    // Outer instances on the same host (localhost ports share one cookie jar) keep separate sessions
    COOKIE_PREFIX: z.string().default("outer-ilha"),
    // comma-separated browser origins allowed cross-origin; the default is the hosted hub
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
  {
    VITE_APP_URL: import.meta.env.VITE_APP_URL,
    // vite.config's runtimeConfig default is "" — treat empty as unset so the default applies
    AUTH_SECRET: runtimeConfig.authSecret || undefined,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    COOKIE_PREFIX: process.env.COOKIE_PREFIX,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
  },
);

const outer = new Outer({
  name: "Outer",
  baseUrl: secrets.get("VITE_APP_URL"),
  db: pglite(),
  // credentials lets browsers (e.g. Outer Hub) send the session cookie cross-origin
  cors: { origins: secrets.get("CORS_ORIGINS"), credentials: true },
  // The `fs` mount from vite.config.ts. Swap that driver for `s3` in production
  // and nothing here changes.
  storage: fromUnstorage(useStorage("fs")),
  // Nitro's unstorage instance, surfaced as `context.kv`. On Cloudflare/Vercel
  // point the default mount at their KV driver and nothing here changes.
  kv: useStorage(),
  // Surfaced as `context.secrets` — read the same validated values in any procedure
  secrets,
})
  .schema(v1_0_0)
  .auth({
    secret: secrets.get("AUTH_SECRET"),
    advanced: { cookiePrefix: secrets.get("COOKIE_PREFIX") },
    plugins: [
      admin(),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          // HINT: Use Resend or Cloudflare Email to send the OTP
          console.log(`OTP for ${email}: ${otp}`);
        },
      }),
    ],
  })
  .openapi()
  .admin()
  // Adds file.upload / list / get / delete / attach / detach plus GET /files/:id.
  // Files default to private: only the uploader can read or delete them.
  .files({ maxBytes: 10 * 1024 * 1024 })
  // `context.user` and `context.session` are already resolved by `.auth()`, and
  // `context.kv` comes from `new Outer({ kv })` — this middleware only adds the
  // extras this app wants.
  .middleware(async ({ next }) => next({ context: { runTask } }))
  .resource("todo", {
    permissions: {
      list: "owner",
      get: "owner",
      create: "authenticated",
      update: "owner",
      delete: "owner",
    },
    ownerColumn: "userId",
    // Timestamps are managed by the DB (and `updatedAt` is auto-touched on
    // update), so keep them out of the create/update input rather than letting
    // a client spoof them. `readonly` strips them; `writable` is the allowlist form.
    readonly: ["createdAt", "updatedAt"],
  })
  .procedure(
    "foo",
    (base) =>
      base.handler(async ({ context }) => {
        // context.kv comes from `new Outer({ kv })`, so it's optional — guard for it
        await context.kv?.setItem("foo", "bar");
        return {
          foo: await context.kv?.getItem("foo"),
          signedInAs: context.user?.email ?? null,
        };
      }),
    { permission: "authenticated" },
  )
  .build();

const { error, results } = await outer.migrator.migrateToLatest();

if (error) {
  console.error(error);
} else {
  if (results?.length) {
    console.info(`[Outer] ${results.length} migrations applied`);
  } else {
    console.info("[Outer] No migrations to apply");
  }
}

// Seed the single admin account so `.admin()` (and Outer Hub) are usable out of the box.
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

export default { fetch: (req: Request) => outer.handle(req) };

export type Router = InferRouter<typeof outer>;

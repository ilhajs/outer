import { Outer, type InferRouter } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { emailOTP } from "better-auth/plugins";
import { serve } from "srvx";
import { z } from "zod";

import { v1_0_0 } from "./schema";

// TODO: Copy .env.example to .env and set AUTH_SECRET in production
const env = z
  .object({
    PORT: z.coerce.number().default(3000),
    BASE_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().default("dev-only-secret"),
    // seeded admin account — signs in via email OTP only (no password); leave unset to skip seeding
    ADMIN_EMAIL: z.email().optional(),
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
  })
  .parse(process.env);

const outer = new Outer({
  name: "Outer",
  db: pglite(),
  baseUrl: env.BASE_URL,
  // credentials lets browsers send the session cookie cross-origin — pair with `credentials: "include"` on the client
  cors: { origins: env.CORS_ORIGINS, credentials: true },
})
  .schema(v1_0_0)
  .auth({
    secret: env.AUTH_SECRET,
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
          // TODO: wire up your email provider (Resend, SMTP, ...) to deliver `otp` to `email`
          void email;
          void otp;
        },
      }),
    ],
  })
  .openapi()
  .admin()
  .resource("post")
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
if (!error && env.ADMIN_EMAIL) {
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

export type Router = InferRouter<typeof outer>;

// swap for Bun.serve/Deno.serve/etc — outer.handle is a plain Fetch handler
serve({
  fetch: (req) => outer.handle(req),
  port: env.PORT,
});

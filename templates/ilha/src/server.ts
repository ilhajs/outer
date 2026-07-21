import { v1_0_0 } from "$lib/schemas/v1-0-0";
import { fromUnstorage, Outer, type InferRouter } from "@outerjs/server";
import { pglite } from "@outerjs/server/pglite";
import { admin, emailOTP } from "better-auth/plugins";
import { useRuntimeConfig } from "nitro/runtime-config";
import { useStorage } from "nitro/storage";
import { runTask } from "nitro/task";
import { z } from "zod";

const runtimeConfig = useRuntimeConfig();

// TODO: Set NITRO_AUTH_SECRET and VITE_APP_URL in production — the fallbacks are for local development only
const env = z
  .object({
    VITE_APP_URL: z.string().default("http://localhost:3000"),
    authSecret: z.string().min(1).default("dev-only-secret"),
  })
  .parse({
    VITE_APP_URL: import.meta.env.VITE_APP_URL,
    // vite.config's runtimeConfig default is "" — treat empty as unset so the default applies
    authSecret: runtimeConfig.authSecret || undefined,
  });

const outer = new Outer({
  name: "Outer",
  baseUrl: env.VITE_APP_URL,
  db: pglite(),
  // The `fs` mount from vite.config.ts. Swap that driver for `s3` in production
  // and nothing here changes.
  storage: fromUnstorage(useStorage("fs")),
})
  .schema(v1_0_0)
  .auth({
    secret: env.authSecret,
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
  // `context.user` and `context.session` are already resolved by `.auth()` —
  // this middleware only adds the extras this app wants.
  .middleware(async ({ next }) => next({ context: { kv: useStorage(), runTask } }))
  .resource("todo", {
    permissions: {
      list: "owner",
      get: "owner",
      create: "authenticated",
      update: "owner",
      delete: "owner",
    },
    ownerColumn: "userId",
  })
  .procedure(
    "foo",
    (base) =>
      base.handler(async ({ context }) => {
        await context.kv.setItem("foo", "bar");
        return { foo: await context.kv.getItem("foo"), signedInAs: context.user?.email ?? null };
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

export default { fetch: (req: Request) => outer.handle(req) };

export type Router = InferRouter<typeof outer>;

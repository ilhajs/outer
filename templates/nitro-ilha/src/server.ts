import { Outer, type InferRouter } from "@outerjs/server";
import { useStorage } from "nitro/storage";
import { runTask } from "nitro/task";
import { emailOTP } from "better-auth/plugins";
import { v1_0_0 } from "$lib/schemas/v1-0-0";
import { useRuntimeConfig } from "nitro/runtime-config";

const runtimeConfig = useRuntimeConfig();

const outer = new Outer({ name: "Outer", baseUrl: import.meta.env.VITE_APP_URL })
  .schema(v1_0_0)
  .auth({
    secret: runtimeConfig.authSecret,
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          // HINT: Use Resend or Cloudflare Email to send the OTP
          console.log(`OTP for ${email}: ${otp}`);
        },
      }),
    ],
  })
  .middleware(async ({ context, next }) => {
    const kv = useStorage();
    const fs = useStorage("fs");
    const authSession = await context.auth.api.getSession({ headers: context.headers });
    return next({
      context: { session: authSession?.session, user: authSession?.user, kv, fs, runTask },
    });
  })
  .procedure("foo", (base) =>
    base.handler(async ({ context }) => {
      await context.kv.setItem("foo", "bar");
      const foo = await context.kv.getItem("foo");
      return { foo };
    }),
  )
  .build();

await outer.migrator.migrateToLatest();

export default { fetch: (req: Request) => outer.handle(req) };

export type Router = InferRouter<typeof outer>;

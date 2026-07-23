import { neon } from "@neondatabase/serverless";
import { Outer, type InferRouter } from "@outerjs/server";
import { schema, timestamps } from "@outerjs/server/schema";
import { type OuterStorage } from "@outerjs/server/storage";
import { del, get, put } from "@vercel/blob";
import { emailOTP } from "better-auth/plugins";
import { NeonDialect } from "kysely-neon";
import { createStorage } from "unstorage";
import vercelRuntimeCacheDriver from "unstorage/drivers/vercel-runtime-cache";
import { z } from "zod";

// TODO: Set DATABASE_URL and AUTH_SECRET in your Vercel project env — the AUTH_SECRET fallback is for local development only
const env = z
  .object({
    DATABASE_URL: z.string(),
    BASE_URL: z.string().default("http://localhost:3000"),
    AUTH_SECRET: z.string().default("dev-only-secret"),
    // seeded admin account (signs in via email OTP) — `npm run migrate` seeds it; leave unset to skip
    ADMIN_EMAIL: z.email().optional(),
    // namespaces this instance's auth cookies — set a unique value per instance so several
    // Outer instances on the same host keep separate sessions
    COOKIE_PREFIX: z.string().default("outer-vercel"),
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
    // Added to the project automatically when you create a Blob store; pull it locally
    // with `vercel env pull`. The @vercel/blob SDK reads it from process.env on its own.
    BLOB_READ_WRITE_TOKEN: z.string(),
  })
  .parse(process.env);

/**
 * `OuterStorage` is three methods on purpose, so a backend needs no adapter package.
 * Vercel Blob's pathname-addressed API maps onto it directly — Outer's storage keys
 * become blob pathnames verbatim, so `addRandomSuffix` stays off.
 *
 * `access: "private"` keeps the blob URLs unguessable and unreadable without the token:
 * bytes reach the browser only through Outer's own `GET /files/:id`, which applies the
 * `.files()` permissions. A public store would leave the blob URL readable by anyone.
 */
const vercelBlob: OuterStorage = {
  async get(key) {
    const blob = await get(key, { access: "private" });
    if (!blob?.stream) return null;
    return new Uint8Array(await new Response(blob.stream).arrayBuffer());
  },
  async set(key, bytes) {
    // put() takes a Blob/Buffer/stream, not a bare Uint8Array; Buffer.from views the
    // same memory rather than copying it
    await put(key, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  },
  delete: (key) => del(key),
};

const v1_0_0 = schema("1.0.0")
  // Better Auth core tables + admin plugin fields (role, banned, impersonatedBy, ...)
  .auth()
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    ...timestamps(t),
  }))
  // Adds the `file` metadata table plus a `post_file` pivot. Neon holds only the
  // metadata and ownership; the bytes go to Vercel Blob (see `storage` below).
  .files({ attachTo: ["post"] })
  .build();

const outer = new Outer({
  name: "Outer",
  baseUrl: env.BASE_URL,
  db: {
    dialect: new NeonDialect({ neon: neon(env.DATABASE_URL) }),
    kind: "postgres", // Neon is real Postgres
  },
  // credentials lets browsers (e.g. Outer Hub) send the session cookie cross-origin
  cors: { origins: env.CORS_ORIGINS, credentials: true },
  // Serverless functions have no persistent disk, so uploaded bytes go to Vercel Blob
  storage: vercelBlob,
  // `context.kv`, backed by Vercel's Runtime Cache — built into the runtime, no store to
  // provision. It's a cache (entries can be evicted, and it can't list keys), so use it for
  // rate-limit counters, feature flags, and idempotency keys, not anything you can't recompute.
  kv: createStorage({ driver: vercelRuntimeCacheDriver({ ttl: 60 }) }),
})
  .schema(v1_0_0)
  .auth({
    secret: env.AUTH_SECRET,
    advanced: { cookiePrefix: env.COOKIE_PREFIX },
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
          // HINT: use Resend (or any email provider) here; the log is for local development
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
      // Serve a cached count when the Runtime Cache still has it — a typical `context.kv` use.
      const cached = await context.kv?.getItem<number>("post:count");
      if (typeof cached === "number") return { count: cached };
      const rows = await context.db
        .selectFrom("post")
        .select(context.db.fn.countAll().as("count"))
        .execute();
      const count = Number(rows[0]?.count ?? 0);
      await context.kv?.setItem("post:count", count, { ttl: 60 });
      return { count };
    }),
  )
  .build();

export type Router = InferRouter<typeof outer>;

// reused by scripts/migrate.ts — migrations run there, not per-request (see README)
export { outer, env };

// must be a named `fetch` export, not `export default` — see README
export async function fetch(request: Request): Promise<Response> {
  return outer.handle(request);
}

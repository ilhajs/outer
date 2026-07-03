import { serve } from "srvx";

import { Outer, schema } from "../src/index";
import { pgliteDb } from "../src/pglite";

const v1_0 = schema("1.0.0")
  .table("user", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
    email: t.text().unique(),
    emailVerified: t.boolean().default("false"),
    image: t.text().nullable(),
    createdAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().default("CURRENT_TIMESTAMP"),
  }))
  .table("session", (t) => ({
    id: t.text().primaryKey(),
    expiresAt: t.timestamp(),
    token: t.text().unique(),
    createdAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    ipAddress: t.text().nullable(),
    userAgent: t.text().nullable(),
    userId: t.text().references("user", "id"),
  }))
  .table("account", (t) => ({
    id: t.text().primaryKey(),
    accountId: t.text(),
    providerId: t.text(),
    userId: t.text().references("user", "id"),
    accessToken: t.text().nullable(),
    refreshToken: t.text().nullable(),
    idToken: t.text().nullable(),
    accessTokenExpiresAt: t.timestamp().nullable(),
    refreshTokenExpiresAt: t.timestamp().nullable(),
    scope: t.text().nullable(),
    password: t.text().nullable(),
    createdAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().default("CURRENT_TIMESTAMP"),
  }))
  .table("verification", (t) => ({
    id: t.text().primaryKey(),
    identifier: t.text(),
    value: t.text(),
    expiresAt: t.timestamp(),
    createdAt: t.timestamp().default("CURRENT_TIMESTAMP"),
    updatedAt: t.timestamp().default("CURRENT_TIMESTAMP"),
  }))
  .relation("user", (rel) => rel.hasMany("session", { from: "id", to: "userId" }))
  .relation("user", (rel) => rel.hasMany("account", { from: "id", to: "userId" }))
  .relation("session", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .relation("account", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

const outer = new Outer({ name: "Outer", baseUrl: "http://localhost:3000", db: pgliteDb() })
  .schema(v1_0)
  .auth({ secret: "test-secret" })
  .middleware(async ({ context, next }) => {
    const authSession = await context.auth.api.getSession({ headers: context.headers });
    return next({ context: { session: authSession?.session, user: authSession?.user } });
  })
  .procedure("user.me", (base) =>
    base.handler(async ({ context }) => {
      return { user: context.user };
    }),
  )
  .build();

await outer.migrator.migrateToLatest();

serve({
  fetch: (req) => outer.handle(req),
});

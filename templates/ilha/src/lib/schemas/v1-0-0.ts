import { schema, timestamps } from "@outerjs/server";

export const v1_0_0 = schema("1.0.0")
  .table("user", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
    email: t.text().unique(),
    emailVerified: t.boolean().default("false"),
    image: t.text().nullable(),
    ...timestamps(t),
  }))
  .table("session", (t) => ({
    id: t.text().primaryKey(),
    expiresAt: t.timestamp(),
    token: t.text().unique(),
    ipAddress: t.text().nullable(),
    userAgent: t.text().nullable(),
    userId: t.text().references("user", "id"),
    ...timestamps(t),
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
    ...timestamps(t),
  }))
  .table("verification", (t) => ({
    id: t.text().primaryKey(),
    identifier: t.text(),
    value: t.text(),
    expiresAt: t.timestamp(),
    ...timestamps(t),
  }))
  .table("todo", (t) => ({
    id: t.text().primaryKey(),
    title: t.text(),
    description: t.text().nullable(),
    userId: t.text().references("user", "id"),
    ...timestamps(t),
  }))
  .relation("user", (rel) =>
    rel.hasMany("session", { from: "id", to: "userId" }),
  )
  .relation("user", (rel) =>
    rel.hasMany("account", { from: "id", to: "userId" }),
  )
  .relation("user", (rel) => rel.hasMany("todo", { from: "id", to: "userId" }))
  .relation("session", (rel) =>
    rel.belongsTo("user", { from: "userId", to: "id" }),
  )
  .relation("account", (rel) =>
    rel.belongsTo("user", { from: "userId", to: "id" }),
  )
  .relation("todo", (rel) =>
    rel.belongsTo("user", { from: "userId", to: "id" }),
  )
  .build();

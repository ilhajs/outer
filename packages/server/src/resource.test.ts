import { test, describe, beforeAll, expect } from "bun:test";

import { z } from "zod/v4";

import { Outer, schema } from "./index";
import { pglite } from "./pglite";

const s = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().nullable(),
    status: t.text().default("'draft'"),
  }))
  .build();

function makeApp(opts?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1]) {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: pglite({ dataDir: "memory://" }),
  })
    .schema(s)
    .auth({ secret: "test-secret" })
    .resource("post", opts)
    .build();
}

async function rpc(app: Awaited<ReturnType<typeof makeApp>>, action: string, input?: unknown) {
  const res = await app.handle(
    new Request(`http://localhost/rpc/post/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input ?? {} }),
    }),
  );
  const body = (await res.json()) as any;
  return { status: res.status, output: body.json };
}

// ── CRUD ──────────────────────────────────────────────────────────────────

describe("resource — CRUD", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = makeApp();
    await app.migrator.migrateToLatest();
  });

  test("create returns the inserted row", async () => {
    const { status, output } = await rpc(app, "create", { title: "Hello" });
    expect(status).toBe(200);
    expect(output.title).toBe("Hello");
    expect(output.id).toBeTruthy();
  });

  test("list returns all rows", async () => {
    const { status, output } = await rpc(app, "list");
    expect(status).toBe(200);
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBeGreaterThanOrEqual(1);
  });

  test("get returns row by primary key", async () => {
    const { output: created } = await rpc(app, "create", { title: "Get me" });
    const { status, output } = await rpc(app, "get", { id: created.id });
    expect(status).toBe(200);
    expect(output.title).toBe("Get me");
  });

  test("get returns null for missing row", async () => {
    const { output } = await rpc(app, "get", { id: 99999 });
    expect(output).toBeNull();
  });

  test("update changes the row", async () => {
    const { output: created } = await rpc(app, "create", { title: "Old title" });
    const { status, output } = await rpc(app, "update", {
      where: { id: created.id },
      data: { title: "New title" },
    });
    expect(status).toBe(200);
    expect(output.title).toBe("New title");
  });

  test("delete removes the row and returns it", async () => {
    const { output: created } = await rpc(app, "create", { title: "To delete" });
    const { status, output: deleted } = await rpc(app, "delete", { id: created.id });
    expect(status).toBe(200);
    expect(deleted.id).toBe(created.id);
    expect((await rpc(app, "get", { id: created.id })).output).toBeNull();
  });

  test("serial PK is omitted from create input; SQL default is applied", async () => {
    const { status, output } = await rpc(app, "create", { title: "Defaults" });
    expect(status).toBe(200);
    expect(output.status).toBe("draft");
  });

  test("update on a missing row returns 404", async () => {
    const { status } = await rpc(app, "update", { where: { id: 99999 }, data: { title: "X" } });
    expect(status).toBe(404);
  });

  test("delete on a missing row returns 404", async () => {
    const { status } = await rpc(app, "delete", { id: 99999 });
    expect(status).toBe(404);
  });

  test("update with an empty data object returns 400", async () => {
    const { output: created } = await rpc(app, "create", { title: "Untouched" });
    const { status } = await rpc(app, "update", { where: { id: created.id }, data: {} });
    expect(status).toBe(400);
  });
});

describe("resource — list pagination cap", () => {
  test("defaults to 50 rows and rejects `take` above the max", async () => {
    const app = makeApp({ listLimit: { default: 2, max: 3 } });
    await app.migrator.migrateToLatest();
    await rpc(app, "create", { title: "A" });
    await rpc(app, "create", { title: "B" });
    await rpc(app, "create", { title: "C" });

    const { output: defaultPage } = await rpc(app, "list");
    expect(defaultPage.length).toBe(2);

    const { status } = await rpc(app, "list", { take: 4 });
    expect(status).toBe(400);
  });
});

describe("resource — eager config validation", () => {
  test("'owner' permission without ownerColumn throws when .resource() is called", () => {
    expect(() => makeApp({ permissions: { update: "owner" } })).toThrow(/ownerColumn/);
  });
});

// ── DB error mapping ─────────────────────────────────────────────────────

const uniqueSchema = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text().unique(),
  }))
  .build();

function makeUniqueApp() {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: pglite({ dataDir: "memory://" }),
  })
    .schema(uniqueSchema)
    .resource("post")
    .build();
}

describe("resource — DB error mapping", () => {
  let app: Awaited<ReturnType<typeof makeUniqueApp>>;

  beforeAll(async () => {
    app = makeUniqueApp();
    await app.migrator.migrateToLatest();
  });

  test("unique constraint violation on create returns 409", async () => {
    const first = await rpc(app, "create", { title: "Dup" });
    expect(first.status).toBe(200);

    const second = await rpc(app, "create", { title: "Dup" });
    expect(second.status).toBe(409);
  });

  test("unique constraint violation on update returns 409", async () => {
    await rpc(app, "create", { title: "Keep me" });
    const { output: other } = await rpc(app, "create", { title: "Other" });

    const { status } = await rpc(app, "update", {
      where: { id: other.id },
      data: { title: "Keep me" },
    });
    expect(status).toBe(409);
  });
});

// ── Permissions ────────────────────────────────────────────────────────────

describe("resource — permissions", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = makeApp({
      permissions: {
        list: "public",
        get: "public",
        create: "authenticated",
        update: "authenticated",
        delete: "authenticated",
      },
    });
    await app.migrator.migrateToLatest();
  });

  test("public list works without a session", async () => {
    expect((await rpc(app, "list")).status).toBe(200);
  });

  test("authenticated create fails without a session", async () => {
    const { status } = await rpc(app, "create", { title: "X" });
    expect(status === 401 || status === 403).toBe(true);
  });

  test("authenticated update fails without a session", async () => {
    const { status } = await rpc(app, "update", { where: { id: 1 }, data: { title: "X" } });
    expect(status === 401 || status === 403).toBe(true);
  });

  test("authenticated delete fails without a session", async () => {
    const { status } = await rpc(app, "delete", { id: 1 });
    expect(status === 401 || status === 403).toBe(true);
  });
});

describe("resource — custom permission function", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = makeApp({
      permissions: {
        list: () => false,
        get: () => true,
      },
    });
    await app.migrator.migrateToLatest();
  });

  test("custom fn returning false blocks the action", async () => {
    const { status } = await rpc(app, "list");
    expect(status === 401 || status === 403).toBe(true);
  });

  test("custom fn returning true allows the action", async () => {
    expect((await rpc(app, "get", { id: 99999 })).status).toBe(200);
  });
});

// ── owner / admin permissions (real authenticated sessions) ────────────────

const authSchema = schema("1.0.0")
  .table("user", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
    email: t.text().unique(),
    emailVerified: t.boolean().default("false"),
    image: t.text().nullable(),
    role: t.text().default("'user'"),
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
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().nullable(),
  }))
  .relation("user", (rel) => rel.hasMany("session", { from: "id", to: "userId" }))
  .relation("user", (rel) => rel.hasMany("account", { from: "id", to: "userId" }))
  .relation("session", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .relation("account", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

function makeAuthApp(opts?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1]) {
  return (
    new Outer({ name: "Test", baseUrl: "http://localhost", db: pglite({ dataDir: "memory://" }) })
      .schema(authSchema)
      .auth({
        secret: "test-secret",
        emailAndPassword: { enabled: true },
        user: {
          additionalFields: { role: { type: "string", defaultValue: "user", input: false } },
        },
      })
      .resource("post", opts)
      // test-only helper to promote a user to admin without wiring up the admin plugin
      .procedure("test.promote", (base) =>
        base.input(z.object({ userId: z.string() })).handler(async ({ context, input }) => {
          await context.db
            .updateTable("user")
            .set({ role: "admin" })
            .where("id", "=", input.userId)
            .execute();
          return { ok: true };
        }),
      )
      .build()
  );
}

async function signUp(app: Awaited<ReturnType<typeof makeAuthApp>>, email: string) {
  const res = await app.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123", name: "Test User" }),
    }),
  );
  const body = (await res.json()) as { user: { id: string } };
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { userId: body.user.id, cookie: cookies };
}

async function rpcAs(
  app: Awaited<ReturnType<typeof makeAuthApp>>,
  cookie: string,
  action: string,
  input?: unknown,
) {
  const res = await app.handle(
    new Request(`http://localhost/rpc/post/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ json: input ?? {} }),
    }),
  );
  const body = (await res.json()) as any;
  return { status: res.status, output: body.json };
}

describe("resource — owner permission (real sessions)", () => {
  let app: Awaited<ReturnType<typeof makeAuthApp>>;
  let owner: { userId: string; cookie: string };
  let other: { userId: string; cookie: string };
  let postId: number;

  beforeAll(async () => {
    app = makeAuthApp({
      permissions: { create: "authenticated", update: "owner", delete: "owner" },
      ownerColumn: "userId",
    });
    await app.migrator.migrateToLatest();
    owner = await signUp(app, "owner@test.com");
    other = await signUp(app, "other@test.com");

    const res = await app.handle(
      new Request("http://localhost/rpc/post/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ json: { title: "Owner's post" } }),
      }),
    );
    postId = ((await res.json()) as any).json.id;
  });

  test("owner can update their own row", async () => {
    const { status, output } = await rpcAs(app, owner.cookie, "update", {
      where: { id: postId },
      data: { title: "Updated by owner" },
    });
    expect(status).toBe(200);
    expect(output.title).toBe("Updated by owner");
  });

  test("a different signed-in user cannot update someone else's row", async () => {
    const { status } = await rpcAs(app, other.cookie, "update", {
      where: { id: postId },
      data: { title: "Hijacked" },
    });
    expect(status).toBe(403);
  });

  test("a different signed-in user cannot delete someone else's row", async () => {
    const { status } = await rpcAs(app, other.cookie, "delete", { id: postId });
    expect(status).toBe(403);
  });

  test("owner can delete their own row", async () => {
    const { status } = await rpcAs(app, owner.cookie, "delete", { id: postId });
    expect(status).toBe(200);
  });
});

describe("resource — admin permission (real sessions)", () => {
  let app: Awaited<ReturnType<typeof makeAuthApp>>;
  let admin: { userId: string; cookie: string };
  let regular: { userId: string; cookie: string };
  let postId: number;

  beforeAll(async () => {
    app = makeAuthApp({ permissions: { delete: "admin" } });
    await app.migrator.migrateToLatest();
    admin = await signUp(app, "admin@test.com");
    regular = await signUp(app, "regular@test.com");
    await app.handle(
      new Request("http://localhost/rpc/test/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { userId: admin.userId } }),
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/rpc/post/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: regular.cookie },
        body: JSON.stringify({ json: { title: "Some post" } }),
      }),
    );
    postId = ((await res.json()) as any).json.id;
  });

  test("non-admin signed-in user cannot delete", async () => {
    const { status } = await rpcAs(app, regular.cookie, "delete", { id: postId });
    expect(status).toBe(403);
  });

  test("admin can delete", async () => {
    const { status } = await rpcAs(app, admin.cookie, "delete", { id: postId });
    expect(status).toBe(200);
  });
});

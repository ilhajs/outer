import { test, describe, beforeAll, expect } from "bun:test";

import { z } from "zod/v4";

import { Outer, schema } from "./index";
import { fastPasswordHashing, testDb } from "./test-utils";

const s = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().nullable(),
    status: t.text().default("'draft'"),
  }))
  .build();

const postDb = testDb([s]);

async function makeApp(
  opts?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1],
) {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: await postDb(),
  })
    .schema(s)
    .auth({ secret: "test-secret" })
    .resource("post", opts)
    .build();
}

async function rpc(
  app: { handle: (req: Request) => Promise<Response> },
  action: string,
  input?: unknown,
) {
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
    app = await makeApp();
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

  test("update can change a defaulted text column", async () => {
    const { output: created } = await rpc(app, "create", { title: "Post" });
    expect(created.status).toBe("draft");
    const { status, output } = await rpc(app, "update", {
      where: { id: created.id },
      data: { status: "published" },
    });
    expect(status).toBe(200);
    expect(output.status).toBe("published");
  });
});

const todoSchema = schema("1.0.0")
  .table("todo", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    completed: t.boolean().default("false"),
  }))
  .build();

const todoDb = testDb([todoSchema]);

async function makeTodoApp() {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: await todoDb(),
  })
    .schema(todoSchema)
    .resource("todo")
    .build();
}

async function todoRpc(
  app: Awaited<ReturnType<typeof makeTodoApp>>,
  action: string,
  input?: unknown,
) {
  const res = await app.handle(
    new Request(`http://localhost/rpc/todo/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input ?? {} }),
    }),
  );
  const body = (await res.json()) as any;
  return { status: res.status, output: body.json };
}

describe("resource — update boolean columns with defaults", () => {
  let app: Awaited<ReturnType<typeof makeTodoApp>>;

  beforeAll(async () => {
    app = await makeTodoApp();
    await app.migrator.migrateToLatest();
  });

  test("create applies boolean default", async () => {
    const { status, output } = await todoRpc(app, "create", { title: "Task" });
    expect(status).toBe(200);
    expect(output.completed).toBe(false);
  });

  test("update sets completed to true", async () => {
    const { output: created } = await todoRpc(app, "create", { title: "Done me" });
    const { status, output } = await todoRpc(app, "update", {
      where: { id: created.id },
      data: { completed: true },
    });
    expect(status).toBe(200);
    expect(output.completed).toBe(true);
  });

  test("update sets completed to false", async () => {
    const { output: created } = await todoRpc(app, "create", { title: "Undo me" });
    await todoRpc(app, "update", { where: { id: created.id }, data: { completed: true } });
    const { status, output } = await todoRpc(app, "update", {
      where: { id: created.id },
      data: { completed: false },
    });
    expect(status).toBe(200);
    expect(output.completed).toBe(false);
  });
});

describe("resource — list pagination cap", () => {
  test("defaults to 50 rows and rejects `take` above the max", async () => {
    const app = await makeApp({ listLimit: { default: 2, max: 3 } });
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

describe("resource — list filtering, ordering, pagination", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
    await app.migrator.migrateToLatest();
    await rpc(app, "create", { title: "Alpha" });
    await rpc(app, "create", { title: "Beta" });
    await rpc(app, "create", { title: "Alpine" });
  });

  test("where with a filter operator", async () => {
    const { status, output } = await rpc(app, "list", {
      where: { title: { startsWith: "Alp" } },
    });
    expect(status).toBe(200);
    expect(output.map((r: any) => r.title).sort()).toEqual(["Alpha", "Alpine"]);
  });

  test("where with a plain equality value", async () => {
    const { output } = await rpc(app, "list", { where: { title: "Beta" } });
    expect(output.length).toBe(1);
    expect(output[0].title).toBe("Beta");
  });

  test("where with OR", async () => {
    const { output } = await rpc(app, "list", {
      where: { OR: [{ title: "Beta" }, { title: "Alpha" }] },
    });
    expect(output.length).toBe(2);
  });

  test("orderBy desc", async () => {
    const { output } = await rpc(app, "list", { orderBy: [{ id: "desc" }] });
    const ids = output.map((r: any) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  test("skip offsets results", async () => {
    const { output: all } = await rpc(app, "list", { orderBy: [{ id: "asc" }] });
    const { output: skipped } = await rpc(app, "list", { orderBy: [{ id: "asc" }], skip: 1 });
    expect(skipped.length).toBe(all.length - 1);
    expect(skipped[0].id).toBe(all[1].id);
  });

  test("invalid orderBy direction returns 400", async () => {
    const { status } = await rpc(app, "list", { orderBy: [{ id: "sideways" }] });
    expect(status).toBe(400);
  });
});

describe("resource — createMany", () => {
  test("inserts multiple rows and returns them", async () => {
    const app = await makeApp();
    await app.migrator.migrateToLatest();
    const { status, output } = await rpc(app, "createMany", {
      data: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
    });
    expect(status).toBe(200);
    expect(output.length).toBe(3);
    expect((await rpc(app, "list")).output.length).toBe(3);
  });

  test("empty data array returns 400", async () => {
    const app = await makeApp();
    await app.migrator.migrateToLatest();
    const { status } = await rpc(app, "createMany", { data: [] });
    expect(status).toBe(400);
  });
});

// ── include (relations) ────────────────────────────────────────────────────

const relSchema = schema("1.0.0")
  .table("author", (t) => ({
    id: t.serial().primaryKey(),
    name: t.text(),
  }))
  .table("book", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    authorId: t.integer().nullable(),
  }))
  .relation("book", (rel) => rel.belongsTo("author", { from: "authorId", to: "id" }))
  .relation("author", (rel) => rel.hasMany("book", { from: "id", to: "authorId" }))
  .build();

const relDb = testDb([relSchema]);

describe("resource — include", () => {
  let app: any;
  let authorId: number;
  let bookId: number;

  async function call(resource: string, action: string, input?: unknown) {
    const res = await app.handle(
      new Request(`http://localhost/rpc/${resource}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input ?? {} }),
      }),
    );
    const body = (await res.json()) as any;
    return { status: res.status, output: body.json };
  }

  beforeAll(async () => {
    app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: await relDb(),
    })
      .schema(relSchema)
      .resource("author", { includable: ["book"] })
      .resource("book", { includable: ["author"] })
      .build();
    await app.migrator.migrateToLatest();
    authorId = (await call("author", "create", { name: "Ryuz" })).output.id;
    bookId = (await call("book", "create", { title: "Outer Guide", authorId })).output.id;
  });

  test("get with include returns the belongsTo relation", async () => {
    const { status, output } = await call("book", "get", { id: bookId, include: { author: true } });
    expect(status).toBe(200);
    expect(output.author.name).toBe("Ryuz");
  });

  test("list with include returns hasMany relations as arrays", async () => {
    const { status, output } = await call("author", "list", { include: { book: true } });
    expect(status).toBe(200);
    expect(output[0].book.length).toBe(1);
    expect(output[0].book[0].title).toBe("Outer Guide");
  });

  test("get without include omits relation fields", async () => {
    const { output } = await call("book", "get", { id: bookId });
    expect(output.author).toBeUndefined();
  });

  test("include of an unknown relation returns 400", async () => {
    const { status } = await call("book", "get", { id: bookId, include: { publisher: true } });
    expect(status).toBe(400);
  });
});

describe("resource — eager config validation", () => {
  test("'owner' permission without ownerColumn throws when .resource() is called", () => {
    expect(makeApp({ permissions: { update: "owner" } })).rejects.toThrow(/ownerColumn/);
  });

  test("includable naming a nonexistent relation throws when .resource() is called", () => {
    expect(makeApp({ includable: ["comment"] })).rejects.toThrow(/includable/);
  });
});

describe("resource — list skip cap", () => {
  test("skip beyond maxSkip returns 400", async () => {
    const app = await makeApp();
    await app.migrator.migrateToLatest();
    const { status } = await rpc(app, "list", { skip: 10_001 });
    expect(status).toBe(400);
  });
});

// ── DB error mapping ─────────────────────────────────────────────────────

const uniqueSchema = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text().unique(),
  }))
  .build();

const uniqueDb = testDb([uniqueSchema]);

async function makeUniqueApp() {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: await uniqueDb(),
  })
    .schema(uniqueSchema)
    .resource("post")
    .build();
}

describe("resource — DB error mapping", () => {
  let app: Awaited<ReturnType<typeof makeUniqueApp>>;

  beforeAll(async () => {
    app = await makeUniqueApp();
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
    app = await makeApp({
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
    app = await makeApp({
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

const authDb = testDb([authSchema]);

async function makeAuthApp(
  opts?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1],
) {
  return (
    new Outer({ name: "Test", baseUrl: "http://localhost", db: await authDb() })
      .schema(authSchema)
      .auth({
        secret: "test-secret",
        emailAndPassword: fastPasswordHashing,
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
    app = await makeAuthApp({
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

describe("resource — owner-scoped list (real sessions)", () => {
  let app: Awaited<ReturnType<typeof makeAuthApp>>;
  let alice: { userId: string; cookie: string };
  let bob: { userId: string; cookie: string };

  beforeAll(async () => {
    app = await makeAuthApp({
      permissions: { list: "owner", create: "authenticated" },
      ownerColumn: "userId",
    });
    await app.migrator.migrateToLatest();
    alice = await signUp(app, "alice@test.com");
    bob = await signUp(app, "bob@test.com");
    await rpcAs(app, alice.cookie, "create", { title: "Alice 1" });
    await rpcAs(app, alice.cookie, "create", { title: "Alice 2" });
    await rpcAs(app, bob.cookie, "create", { title: "Bob 1" });
  });

  test("each user only sees their own rows", async () => {
    const { status, output } = await rpcAs(app, alice.cookie, "list");
    expect(status).toBe(200);
    expect(output.length).toBe(2);
    expect(output.every((r: any) => r.userId === alice.userId)).toBe(true);

    const { output: bobRows } = await rpcAs(app, bob.cookie, "list");
    expect(bobRows.length).toBe(1);
  });

  test("owner scoping composes with a where filter", async () => {
    const { output } = await rpcAs(app, alice.cookie, "list", {
      where: { title: { contains: "2" } },
    });
    expect(output.length).toBe(1);
    expect(output[0].title).toBe("Alice 2");
  });

  test("unauthenticated list is rejected", async () => {
    const { status } = await rpc(app as any, "list");
    expect(status).toBe(401);
  });

  test("createMany injects the owner column on every row", async () => {
    const { status, output } = await rpcAs(app, bob.cookie, "createMany", {
      data: [{ title: "Bob 2" }, { title: "Bob 3" }],
    });
    expect(status).toBe(200);
    expect(output.every((r: any) => r.userId === bob.userId)).toBe(true);
  });
});

describe("resource — admin permission (real sessions)", () => {
  let app: Awaited<ReturnType<typeof makeAuthApp>>;
  let admin: { userId: string; cookie: string };
  let regular: { userId: string; cookie: string };
  let postId: number;

  beforeAll(async () => {
    app = await makeAuthApp({ permissions: { delete: "admin" } });
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

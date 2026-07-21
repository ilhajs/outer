import { test, describe, expect, beforeAll } from "bun:test";

import { z } from "zod/v4";

import { Outer, schema, timestamps } from "./index";
import { pglite } from "./pglite";
import { fastPasswordHashing, testDb } from "./test-utils";

// Better Auth core tables (via schema().auth()) plus an app table
const adminSchema = schema("1.0.0")
  .auth()
  // declare the recognised roles, the way an app would
  .table("user", (t) => ({
    role: t.text().enum(["user", "admin", "support"], { multiple: true }).default("user"),
  }))
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    published: t.boolean().default(false),
    userId: t.text().nullable(),
    ...timestamps(t),
  }))
  .relation("post", (rel) => rel.belongsTo("user", { from: "userId", to: "id" }))
  .build();

const adminDb = testDb([adminSchema]);

async function makeAdminApp(opts: { openapi?: boolean } = {}) {
  const outer = new Outer({
    name: "Admin Test",
    baseUrl: "http://localhost",
    db: await adminDb(),
    cors: { origins: ["https://admin.example.com"] },
  })
    .schema(adminSchema)
    .auth({
      secret: "test-secret",
      emailAndPassword: fastPasswordHashing,
      user: {
        additionalFields: { role: { type: "string", defaultValue: "user", input: false } },
      },
    })
    .admin()
    // test-only helper to promote a user to admin without wiring up the admin plugin
    .procedure("test.promote", (base) =>
      base
        .input(z.object({ userId: z.string(), role: z.string().default("admin") }))
        .handler(async ({ context, input }) => {
          await context.db
            .updateTable("user")
            // cast: this helper deliberately writes out-of-band values (e.g. the
            // comma-separated "support,admin") that the column's enum excludes
            .set({ role: input.role as "user" | "admin" })
            .where("id", "=", input.userId)
            .execute();
          return { ok: true };
        }),
    );
  return (opts.openapi ? outer.openapi() : outer).build();
}

type App = Awaited<ReturnType<typeof makeAdminApp>>;

async function signUp(app: App, email: string) {
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

async function rpc(app: App, path: string, input?: unknown, cookie?: string) {
  const res = await app.handle(
    new Request(`http://localhost/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie && { cookie }) },
      body: JSON.stringify({ json: input ?? {} }),
    }),
  );
  const body = (await res.json()) as any;
  return { status: res.status, output: body.json };
}

describe("admin — configuration", () => {
  test(".admin() without .auth() throws at .build()", () => {
    expect(() =>
      new Outer({ name: "Test", db: pglite({ dataDir: "memory://" }) })
        .schema(adminSchema)
        .admin()
        .build(),
    ).toThrow(/`.admin\(\)` requires/);
  });

  test("the _admin namespace is reserved for user procedures", () => {
    expect(() =>
      new Outer({ name: "Test", db: pglite({ dataDir: "memory://" }) })
        .schema(adminSchema)
        .procedure("_admin.evil", (base) => base.handler(async () => "nope")),
    ).toThrow(/reserved/);
  });

  test("constructor cors origins allow a cross-origin admin dashboard", async () => {
    const app = new Outer({
      name: "Test",
      db: pglite({ dataDir: "memory://" }),
      cors: { origins: ["https://admin.example.com"] },
    })
      .schema(adminSchema)
      .auth({ secret: "test-secret" })
      .admin()
      .build();
    const res = await app.handle(
      new Request("http://localhost/rpc/_admin/meta", {
        method: "OPTIONS",
        headers: {
          origin: "https://admin.example.com",
          "access-control-request-method": "POST",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://admin.example.com");
  });
});

describe("admin — API", () => {
  let app: App;
  let admin: { userId: string; cookie: string };
  let regular: { userId: string; cookie: string };

  // The suite-wide --timeout covers this; no local override, so there's one
  // number to raise if CI gets slower.
  beforeAll(async () => {
    app = await makeAdminApp();
    await app.migrator.migrateToLatest();
    admin = await signUp(app, "admin@test.com");
    regular = await signUp(app, "user@test.com");
    await rpc(app, "test/promote", { userId: admin.userId });
  });

  test("unauthenticated calls get 401", async () => {
    const { status } = await rpc(app, "_admin/meta");
    expect(status).toBe(401);
  });

  test("comma-separated roles from Better Auth's admin plugin are recognized", async () => {
    const multi = await signUp(app, "multi@test.com");
    await rpc(app, "test/promote", { userId: multi.userId, role: "support,admin" });
    const { status } = await rpc(app, "_admin/meta", {}, multi.cookie);
    expect(status).toBe(200);
  });

  test("non-admin users get 403", async () => {
    const { status } = await rpc(app, "_admin/meta", {}, regular.cookie);
    expect(status).toBe(403);
  });

  test("meta returns schema introspection", async () => {
    const { status, output } = await rpc(app, "_admin/meta", {}, admin.cookie);
    expect(status).toBe(200);
    expect(output.name).toBe("Admin Test");
    expect(output.dialect).toBe("postgres");
    expect(output.version).toBe("1.0.0");
    expect(output.versions).toEqual(["1.0.0"]);
    // No `.openapi()` on this app, so UIs should hide the API reference.
    expect(output.openapi).toBe(false);
    const post = output.tables.find((t: any) => t.name === "post");
    expect(post).toBeDefined();
    const id = post.columns.find((c: any) => c.name === "id");
    expect(id).toMatchObject({ type: "serial", primaryKey: true });
    const userId = post.columns.find((c: any) => c.name === "userId");
    expect(userId).toMatchObject({ nullable: true, type: "text" });
    const sessionTable = output.tables.find((t: any) => t.name === "session");
    const sessionUserId = sessionTable.columns.find((c: any) => c.name === "userId");
    expect(sessionUserId.references).toEqual({
      table: "user",
      column: "id",
      onDelete: "cascade",
    });
    expect(output.relations).toContainEqual(
      expect.objectContaining({ fromTable: "post", toTable: "user", kind: "belongsTo" }),
    );
  });

  test("meta reports openapi: true when .openapi() is enabled", async () => {
    const openapiApp = await makeAdminApp({ openapi: true });
    await openapiApp.migrator.migrateToLatest();
    const openapiAdmin = await signUp(openapiApp, "openapi-admin@test.com");
    await rpc(openapiApp, "test/promote", { userId: openapiAdmin.userId });
    const { output } = await rpc(openapiApp, "_admin/meta", {}, openapiAdmin.cookie);
    expect(output.openapi).toBe(true);
  });

  test("meta reports enum values for constrained columns", async () => {
    const { output } = await rpc(app, "_admin/meta", {}, admin.cookie);
    const userTable = output.tables.find((t: any) => t.name === "user");
    const role = userTable.columns.find((c: any) => c.name === "role");
    expect(role.enum).toEqual(["user", "admin", "support"]);
    expect(role.multiple).toBe(true); // several roles may be held at once
    const title = output.tables
      .find((t: any) => t.name === "post")
      .columns.find((c: any) => c.name === "title");
    expect(title.enum).toBeNull();
  });

  test("data.update accepts several roles at once", async () => {
    const { status, output } = await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "admin,support" } },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output[0].role).toBe("admin,support");
    await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "user" } },
      admin.cookie,
    );
  });

  test("data.update rejects a set containing an unknown role", async () => {
    const { status, output } = await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "admin,root" } },
      admin.cookie,
    );
    expect(status).toBe(400);
    expect(JSON.stringify(output)).toMatch(/user, admin, support/);
  });

  test("data.update rejects a value outside the column enum", async () => {
    const { status, output } = await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "superuser" } },
      admin.cookie,
    );
    expect(status).toBe(400);
    expect(JSON.stringify(output)).toMatch(/user, admin, support/);
  });

  test("data.update accepts a valid enum value", async () => {
    const { status, output } = await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "admin" } },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output[0].role).toBe("admin");
    // restore, so later tests still see a non-admin user
    await rpc(
      app,
      "_admin/data/update",
      { table: "user", where: { id: regular.userId }, data: { role: "user" } },
      admin.cookie,
    );
  });

  test("migrations reports executed migrations", async () => {
    const { status, output } = await rpc(app, "_admin/migrations", {}, admin.cookie);
    expect(status).toBe(200);
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe("1.0.0");
    expect(output[0].executedAt).not.toBeNull();
  });

  test("data.create inserts a row", async () => {
    const { status, output } = await rpc(
      app,
      "_admin/data/create",
      { table: "post", data: { title: "Hello", userId: admin.userId } },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output.title).toBe("Hello");
    expect(output.id).toBeDefined();
  });

  test("data.list returns rows with a total count", async () => {
    await rpc(
      app,
      "_admin/data/create",
      { table: "post", data: { title: "Second" } },
      admin.cookie,
    );
    const { status, output } = await rpc(
      app,
      "_admin/data/list",
      { table: "post", orderBy: [{ id: "desc" }], take: 1 },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output.data).toHaveLength(1);
    expect(output.count).toBeGreaterThanOrEqual(2);
  });

  test("data.list supports where filters", async () => {
    const { output } = await rpc(
      app,
      "_admin/data/list",
      { table: "post", where: { title: { contains: "Hell" } } },
      admin.cookie,
    );
    expect(output.data).toHaveLength(1);
    expect(output.data[0].title).toBe("Hello");
    expect(output.count).toBe(1);
  });

  test("data.list can browse auth tables", async () => {
    const { output } = await rpc(app, "_admin/data/list", { table: "user" }, admin.cookie);
    expect(output.count).toBeGreaterThanOrEqual(2);
  });

  test("data.get returns a single row or null", async () => {
    const found = await rpc(
      app,
      "_admin/data/get",
      { table: "user", where: { id: admin.userId } },
      admin.cookie,
    );
    expect(found.output.email).toBe("admin@test.com");
    const missing = await rpc(
      app,
      "_admin/data/get",
      { table: "user", where: { id: "nope" } },
      admin.cookie,
    );
    expect(missing.output).toBeNull();
  });

  test("data.update updates matching rows and touches updatedAt", async () => {
    const created = await rpc(
      app,
      "_admin/data/create",
      { table: "post", data: { title: "To update" } },
      admin.cookie,
    );
    const before = created.output.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    const { status, output } = await rpc(
      app,
      "_admin/data/update",
      { table: "post", where: { id: created.output.id }, data: { title: "Updated" } },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output).toHaveLength(1);
    expect(output[0].title).toBe("Updated");
    expect(output[0].updatedAt).not.toBe(before);
  });

  test("data.update on a missing row is 404", async () => {
    const { status } = await rpc(
      app,
      "_admin/data/update",
      { table: "post", where: { id: 999999 }, data: { title: "x" } },
      admin.cookie,
    );
    expect(status).toBe(404);
  });

  test("data.delete removes matching rows", async () => {
    const created = await rpc(
      app,
      "_admin/data/create",
      { table: "post", data: { title: "To delete" } },
      admin.cookie,
    );
    const { status, output } = await rpc(
      app,
      "_admin/data/delete",
      { table: "post", where: { id: created.output.id } },
      admin.cookie,
    );
    expect(status).toBe(200);
    expect(output).toHaveLength(1);
    const gone = await rpc(
      app,
      "_admin/data/get",
      { table: "post", where: { id: created.output.id } },
      admin.cookie,
    );
    expect(gone.output).toBeNull();
  });

  test("unknown table is a 400", async () => {
    const { status } = await rpc(app, "_admin/data/list", { table: "nope" }, admin.cookie);
    expect(status).toBe(400);
  });

  test("unknown column in where is a 400", async () => {
    const { status } = await rpc(
      app,
      "_admin/data/list",
      { table: "post", where: { hax: 1 } },
      admin.cookie,
    );
    expect(status).toBe(400);
  });

  test("unknown filter operator is a 400", async () => {
    const { status } = await rpc(
      app,
      "_admin/data/list",
      { table: "post", where: { title: { like: "%x%" } } },
      admin.cookie,
    );
    expect(status).toBe(400);
  });

  test("unknown column in create data is a 400", async () => {
    const { status } = await rpc(
      app,
      "_admin/data/create",
      { table: "post", data: { title: "x", hax: true } },
      admin.cookie,
    );
    expect(status).toBe(400);
  });

  test("write where rejects operator objects and empty filters", async () => {
    const operators = await rpc(
      app,
      "_admin/data/delete",
      { table: "post", where: { id: { gt: 0 } } },
      admin.cookie,
    );
    expect(operators.status).toBe(400);
    const empty = await rpc(app, "_admin/data/delete", { table: "post", where: {} }, admin.cookie);
    expect(empty.status).toBe(400);
  });

  test("constraint violations map to clean errors", async () => {
    const { status } = await rpc(
      app,
      "_admin/data/create",
      { table: "user", data: { id: "dupe-check", name: "X", email: "admin@test.com" } },
      admin.cookie,
    );
    expect(status).toBe(409);
  });
});

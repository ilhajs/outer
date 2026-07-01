import { test, describe, beforeAll, expect } from "bun:test";
import { Outer, schema } from "./index";

const s = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    userId: t.text().nullable(),
    status: t.text().default("'draft'"),
  }))
  .build();

function makeApp(opts?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1]) {
  return new Outer({ name: "Test", baseUrl: "http://localhost", db: { dataDir: "memory://" } })
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

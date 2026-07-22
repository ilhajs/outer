import { test, describe, expect, beforeAll } from "bun:test";

import { Outer } from "./index";
import { pglite } from "./pglite";
import { schema } from "./schema";
import { memoryStorage, type OuterStorage } from "./storage";
import { testAuth, testDb } from "./test-utils";

const v1 = schema("1.0.0")
  .auth()
  .table("post", (t) => ({ id: t.text().primaryKey(), title: t.text() }))
  .files({ attachTo: ["post"] })
  .build();

/**
 * Signs a user in through Better Auth and returns their cookie, so tests
 * exercise the same session path a browser does.
 */
async function signIn(app: any, email: string, role?: string) {
  const res = await app.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password1234", name: email }),
    }),
  );
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c: string) => c.split(";")[0])
    .join("; ");
  if (role) {
    await app.db.updateTable("user").set({ role }).where("email", "=", email).execute();
  }
  return cookie;
}

/**
 * Migrating a fresh PGlite costs ~1.4s, which dominates this suite and is what
 * makes CI hooks time out. Apps are built once per distinct `.files()` config
 * and shared; tests keep to their own users and rows so they stay independent.
 */
const appCache = new Map<string, Promise<any>>();

function sharedApp(config: any = {}, storage?: OuterStorage, cacheKey?: string) {
  const key = cacheKey ?? JSON.stringify(config);
  let cached = appCache.get(key);
  if (!cached) {
    cached = (async () => {
      const app = await makeApp(config, storage);
      await app.migrator.migrateToLatest();
      return app;
    })();
    appCache.set(key, cached);
  }
  return cached;
}

const filesDb = testDb([v1]);

async function makeApp(config: any = {}, storage: OuterStorage = memoryStorage()) {
  return new Outer({
    name: "Files",
    baseUrl: "http://localhost",
    db: await filesDb(),
    storage,
  })
    .schema(v1)
    .auth(testAuth())
    .files(config)
    .build();
}

async function rpc(app: any, name: string, body: unknown, cookie?: string) {
  const form = new FormData();
  form.set("data", JSON.stringify({ json: body }));
  return app.handle(
    new Request(`http://localhost/rpc/${name}`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: form,
    }),
  );
}

/** Uploads through the real multipart path oRPC uses for `File` inputs. */
async function upload(app: any, cookie: string, file: File, attach?: unknown) {
  const form = new FormData();
  form.set(
    "data",
    JSON.stringify({ json: { file: "{}", ...(attach ? { attach } : {}) }, meta: [] }),
  );
  form.set("0", file);
  const payload = { file: "0", ...(attach ? { attach } : {}) };
  form.set("data", JSON.stringify({ json: payload, maps: [["file"]] }));
  return app.handle(
    new Request("http://localhost/rpc/file/upload", {
      method: "POST",
      headers: { cookie },
      body: form,
    }),
  );
}

describe(".files() configuration errors", () => {
  test("throws when the schema has no file table", () => {
    const noFiles = schema("1.0.0").auth().build();
    expect(() =>
      new Outer({ db: pglite({ dataDir: "memory://" }), storage: memoryStorage() })
        .schema(noFiles)
        .auth(testAuth())
        .files()
        .build(),
    ).toThrow(/requires a `file` table/);
  });

  test("throws when no storage is configured", () => {
    expect(() =>
      new Outer({ db: pglite({ dataDir: "memory://" }) })
        .schema(v1)
        .auth(testAuth())
        .files()
        .build(),
    ).toThrow(/needs somewhere to put the bytes/);
  });

  test("throws when path is missing :id", () => {
    expect(makeApp({ path: "/files" })).rejects.toThrow(/must contain ":id"/);
  });

  test("throws when a permission needs auth but .auth() was never called", () => {
    expect(() =>
      new Outer({ db: pglite({ dataDir: "memory://" }), storage: memoryStorage() })
        .schema(v1)
        .files()
        .build(),
    ).toThrow(/require a signed-in session/);
  });
});

describe(".files() uploads", () => {
  let app: any;
  const storage = memoryStorage();

  beforeAll(async () => {
    app = await sharedApp({}, storage);
  });

  test("stores the bytes and returns a record with a url", async () => {
    const cookie = await signIn(app, "a@example.com");
    const res = await upload(app, cookie, new File(["hello"], "a.txt", { type: "text/plain" }));
    expect(res.status).toBe(200);
    const { json } = await res.json();

    expect(json.name).toBe("a.txt");
    expect(json.type).toContain("text/plain");
    expect(json.size).toBe(5);
    expect(json.url).toBe(`/files/${json.id}`);
    expect(new TextDecoder().decode((await storage.get(json.key))!)).toBe("hello");
  });

  test("rejects anonymous uploads", async () => {
    const res = await upload(app, "", new File(["x"], "x.txt", { type: "text/plain" }));
    expect(res.status).toBe(401);
  });

  test("rejects uploads over maxBytes", async () => {
    const small = await sharedApp({ maxBytes: 4 });
    const cookie = await signIn(small, "b@example.com");
    const res = await upload(small, cookie, new File(["toolong"], "b.txt", { type: "text/plain" }));
    expect(res.status).toBe(413);
  });

  test("rejects types outside `accept`", async () => {
    const imagesOnly = await sharedApp({ accept: ["image/*"] });
    const cookie = await signIn(imagesOnly, "c@example.com");
    const res = await upload(imagesOnly, cookie, new File(["x"], "c.txt", { type: "text/plain" }));
    expect(res.status).toBe(400);
    const png = await upload(imagesOnly, cookie, new File(["x"], "c.png", { type: "image/png" }));
    expect(png.status).toBe(200);
  });
});

describe(".files() access control", () => {
  let app: any;

  beforeAll(async () => {
    app = await sharedApp();
  });

  test("the download route serves the owner and 404s everyone else", async () => {
    const owner = await signIn(app, "owner@example.com");
    const stranger = await signIn(app, "stranger@example.com");
    const { json: file } = await (
      await upload(app, owner, new File(["secret"], "s.txt", { type: "text/plain" }))
    ).json();

    const mine = await app.handle(
      new Request(`http://localhost${file.url}`, { headers: { cookie: owner } }),
    );
    expect(mine.status).toBe(200);
    expect(await mine.text()).toBe("secret");
    expect(mine.headers.get("content-type")).toContain("text/plain");

    const theirs = await app.handle(
      new Request(`http://localhost${file.url}`, { headers: { cookie: stranger } }),
    );
    expect(theirs.status).toBe(404);

    const anonymous = await app.handle(new Request(`http://localhost${file.url}`));
    expect(anonymous.status).toBe(404);
  });

  test("list only returns the caller's own files", async () => {
    const a = await signIn(app, "list-a@example.com");
    const b = await signIn(app, "list-b@example.com");
    await upload(app, a, new File(["1"], "a.txt", { type: "text/plain" }));
    await upload(app, b, new File(["2"], "b.txt", { type: "text/plain" }));

    const res = await rpc(app, "file/list", {}, a);
    const { json } = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("a.txt");
  });

  test("a stranger cannot delete someone else's file", async () => {
    const owner = await signIn(app, "d-owner@example.com");
    const stranger = await signIn(app, "d-stranger@example.com");
    const { json: file } = await (
      await upload(app, owner, new File(["x"], "d.txt", { type: "text/plain" }))
    ).json();

    expect((await rpc(app, "file/delete", { id: file.id }, stranger)).status).toBe(403);
    expect((await rpc(app, "file/delete", { id: file.id }, owner)).status).toBe(200);
    // `get` mirrors `.resource().get`: a missing row is `null`, not an error
    const gone = await (await rpc(app, "file/get", { id: file.id }, owner)).json();
    expect(gone.json).toBeNull();
  });

  test("permissions: { get: 'public' } serves anonymous readers", async () => {
    const open = await sharedApp({ permissions: { get: "public" } });
    const cookie = await signIn(open, "pub@example.com");
    const { json: file } = await (
      await upload(open, cookie, new File(["open"], "p.txt", { type: "text/plain" }))
    ).json();

    const res = await open.handle(new Request(`http://localhost${file.url}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("open");
    expect(res.headers.get("cache-control")).toContain("public");
  });
});

describe(".files() attachments", () => {
  let app: any;

  beforeAll(async () => {
    app = await sharedApp();
  });

  test("uploads attach to a row and list filters by it", async () => {
    const cookie = await signIn(app, "att@example.com");
    await app.db.insertInto("post").values({ id: "p1", title: "First" }).execute();
    await app.db.insertInto("post").values({ id: "p2", title: "Second" }).execute();

    await upload(app, cookie, new File(["cover"], "cover.png", { type: "image/png" }), {
      table: "post",
      id: "p1",
      role: "cover",
    });
    await upload(app, cookie, new File(["other"], "other.png", { type: "image/png" }));

    const res = await rpc(app, "file/list", { attachedTo: { table: "post", id: "p1" } }, cookie);
    const { json } = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("cover.png");
  });

  test("attaching to a table that isn't in attachTo is a 400", async () => {
    const cookie = await signIn(app, "bad-att@example.com");
    const res = await upload(app, cookie, new File(["x"], "x.png", { type: "image/png" }), {
      table: "user",
      id: "nope",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("not attachable");
  });

  test("attach and detach move an existing file between rows", async () => {
    const cookie = await signIn(app, "move@example.com");
    await app.db.insertInto("post").values({ id: "p3", title: "Third" }).execute();
    const { json: file } = await (
      await upload(app, cookie, new File(["m"], "m.png", { type: "image/png" }))
    ).json();

    await rpc(app, "file/attach", { id: file.id, table: "post", entityId: "p3" }, cookie);
    let listed = (await (
      await rpc(app, "file/list", { attachedTo: { table: "post", id: "p3" } }, cookie)
    ).json()) as any;
    expect(listed.json).toHaveLength(1);

    await rpc(app, "file/detach", { id: file.id, table: "post", entityId: "p3" }, cookie);
    listed = (await (
      await rpc(app, "file/list", { attachedTo: { table: "post", id: "p3" } }, cookie)
    ).json()) as any;
    expect(listed.json).toHaveLength(0);
  });
});

describe(".files() deletion with attachments", () => {
  test("deleting an attached file clears its pivot rows instead of failing on the FK", async () => {
    const storage = memoryStorage();
    // its own app: this test asserts on the whole pivot table being empty
    const app = await sharedApp({}, storage, "cascade");
    const cookie = await signIn(app, "cascade@example.com");
    await app.db.insertInto("post").values({ id: "p9", title: "Ninth" }).execute();

    const { json: file } = await (
      await upload(app, cookie, new File(["bytes"], "a.png", { type: "image/png" }), {
        table: "post",
        id: "p9",
      })
    ).json();

    const res = await rpc(app, "file/delete", { id: file.id }, cookie);
    expect(res.status).toBe(200);

    const pivotRows = await app.db.selectFrom("post_file").selectAll().execute();
    expect(pivotRows).toHaveLength(0);
    expect(await storage.get(file.key)).toBeNull();
  });
});

describe("upload size limits", () => {
  test("an oversized Content-Length is rejected before the body is parsed", async () => {
    const app = await makeApp({ maxBytes: 1024 });
    const res = await app.handle(
      new Request("http://localhost/rpc/file/upload", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data",
          "content-length": String(50 * 1024 * 1024),
        },
        body: "x",
      }),
    );
    expect(res.status).toBe(413);
    expect(JSON.stringify(await res.json())).toMatch(/limit is 1024/);
  });

  test("a file over maxBytes is rejected by the upload procedure", async () => {
    const app = await makeApp({ maxBytes: 8 });
    const cookie = await signIn(app, "size@example.com");
    const big = new File([new Uint8Array(64)], "big.bin", { type: "application/octet-stream" });
    const res = await upload(app, cookie, big);
    expect(res.status).toBe(413);
  });
});

import { test, describe, expect } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { ORPCError } from "@orpc/client";
import { admin as betterAuthAdmin } from "better-auth/plugins";
import { PGliteDialect } from "kysely";

import { Outer, schema } from "./index";
import { pglite } from "./pglite";

const s = schema("1.0.0")
  .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
  .build();

function makeOuter() {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: pglite({ dataDir: "memory://" }),
  }).schema(s);
}

describe("openapi", () => {
  test("/openapi.json is not mounted by default", async () => {
    const app = makeOuter().build();
    const res = await app.handle(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(404);
  });

  test("/openapi.json is mounted when .openapi() is called with no args", async () => {
    const app = makeOuter().openapi().build();
    const res = await app.handle(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.title).toBe("Test");
  });

  test("/openapi.json is mounted when .openapi({ enabled: true }) is called", async () => {
    const app = makeOuter().openapi({ enabled: true }).build();
    const res = await app.handle(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.title).toBe("Test");
  });

  test(".openapi({ enabled: false }) keeps it disabled", async () => {
    const app = makeOuter().openapi({ enabled: false }).build();
    const res = await app.handle(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(404);
  });
});

describe("rest (OpenAPI handler)", () => {
  test("/rest/** serves plain-JSON requests matching the OpenAPI spec", async () => {
    const app = makeOuter().openapi().resource("post").build();
    await app.migrator.migrateToLatest();

    const created = await app.handle(
      new Request("http://localhost/rest/post/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "via rest" }),
      }),
    );
    expect(created.status).toBe(200);
    const row = (await created.json()) as any;
    expect(row.title).toBe("via rest"); // plain JSON, no oRPC envelope
  });

  test("openapi.json advertises the /rest server URL", async () => {
    const app = makeOuter().openapi().build();
    const res = await app.handle(new Request("http://localhost/openapi.json"));
    const body = (await res.json()) as any;
    expect(body.servers[0].url).toBe("http://localhost/rest");
  });

  test("/rest/** is not mounted without .openapi()", async () => {
    const app = makeOuter().resource("post").build();
    const res = await app.handle(
      new Request("http://localhost/rest/post/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "nope" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("client (in-process router client)", () => {
  test("calls procedures directly without HTTP", async () => {
    const app = makeOuter()
      .resource("post")
      .procedure("post.shout", (base) =>
        base.handler(async ({ context }) => {
          const rows = await context.db.query.post.findMany();
          return rows.map((r) => r.title.toUpperCase());
        }),
      )
      .build();
    await app.migrator.migrateToLatest();

    const client = app.client();
    // no cast — resource procedures are strictly typed from the table's columns
    const created = await client.post.create({ title: "hello" });
    expect(created.title).toBe("hello");
    expect(await client.post.shout()).toEqual(["HELLO"]);
  });

  test("evaluates a headers function per call", async () => {
    let calls = 0;
    const app = makeOuter()
      .procedure("echo.header", (base) =>
        base.handler(({ context }) => context.headers.get("x-call")),
      )
      .build();

    const client = app.client(() => {
      calls += 1;
      return new Headers({ "x-call": String(calls) });
    });
    expect(await client.echo.header()).toBe("1");
    expect(await client.echo.header()).toBe("2");
  });
});

describe("db.transact", () => {
  async function callRpc(app: { handle: (req: Request) => Promise<Response> }, name: string) {
    const res = await app.handle(
      new Request(`http://localhost/rpc/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    return { status: res.status, output: ((await res.json()) as any).json };
  }

  test("commits writes and exposes Sola queries on the trx", async () => {
    const app = makeOuter()
      .resource("post")
      .procedure("tx.commit", (base) =>
        base.handler(async ({ context }) => {
          return context.db.transact(async (trx) => {
            await trx.insertInto("post").values({ title: "in tx" }).execute();
            return { count: await trx.query.post.count() };
          });
        }),
      )
      .build();
    await app.migrator.migrateToLatest();

    const { status, output } = await callRpc(app, "tx/commit");
    expect(status).toBe(200);
    expect(output.count).toBe(1);
  });

  test("rolls back when the callback throws", async () => {
    const app = makeOuter()
      .resource("post")
      .procedure("tx.rollback", (base) =>
        base.handler(async ({ context }) => {
          await context.db
            .transact(async (trx) => {
              await trx.insertInto("post").values({ title: "doomed" }).execute();
              throw new Error("boom");
            })
            .catch(() => undefined);
          return { count: await context.db.query.post.count() };
        }),
      )
      .build();
    await app.migrator.migrateToLatest();

    const { output } = await callRpc(app, "tx/rollback");
    expect(output.count).toBe(0);
  });
});

describe("auth baseURL", () => {
  async function getAuthBaseURL(app: { handle: (req: Request) => Promise<Response> }) {
    const res = await app.handle(
      new Request("http://localhost/rpc/baseurl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    return ((await res.json()) as any).json.baseURL;
  }

  test("defaults to the baseUrl passed to new Outer()", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://ctor-default.test",
      db: pglite({ dataDir: "memory://" }),
    })
      .schema(s)
      .auth({ secret: "test-secret" })
      .procedure("baseurl", (base) =>
        base.handler(async ({ context }) => ({ baseURL: (context.auth as any).options.baseURL })),
      )
      .build();

    expect(await getAuthBaseURL(app)).toBe("http://ctor-default.test");
  });

  test("can be overridden per-call via .auth({ baseURL })", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://ctor-default.test",
      db: pglite({ dataDir: "memory://" }),
    })
      .schema(s)
      .auth({ secret: "test-secret", baseURL: "http://override.test" })
      .procedure("baseurl", (base) =>
        base.handler(async ({ context }) => ({ baseURL: (context.auth as any).options.baseURL })),
      )
      .build();

    expect(await getAuthBaseURL(app)).toBe("http://override.test");
  });
});

describe("route", () => {
  test("mounts a raw H3 route with access to context", async () => {
    const app = makeOuter()
      .route("get", "/hello", (_event, context) => {
        return new Response(JSON.stringify({ hasDb: !!context.db }), {
          headers: { "content-type": "application/json" },
        });
      })
      .build();

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasDb: true });
  });

  test("takes precedence over /rpc/** on overlapping paths", async () => {
    const app = makeOuter()
      .route("post", "/rpc/custom", () => new Response("custom"))
      .procedure("custom", (base) => base.handler(async () => "rpc"))
      .build();

    const res = await app.handle(
      new Request("http://localhost/rpc/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    expect(await res.text()).toBe("custom");
  });
});

describe("build-time validation", () => {
  test(".build() throws if a resource permission requires auth but .auth() was never called", () => {
    expect(() =>
      makeOuter()
        .resource("post", { permissions: { create: "authenticated" } })
        .build(),
    ).toThrow(/auth/i);
  });

  test("registering two procedures under the same dot-path throws", () => {
    expect(() =>
      makeOuter()
        .procedure("dup", (base) => base.handler(async () => "a"))
        .procedure("dup", (base) => base.handler(async () => "b")),
    ).toThrow(/collision/i);
  });
});

describe("cors", () => {
  test("adds Access-Control-Allow-Origin for a listed origin", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: pglite({ dataDir: "memory://" }),
      cors: { origins: ["https://allowed.test"] },
    })
      .schema(s)
      .procedure("ping", (base) => base.handler(async () => "pong"))
      .build();

    const res = await app.handle(
      new Request("http://localhost/rpc/ping", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://allowed.test" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.test");
  });

  test("does not add CORS headers for an origin not in the allow-list", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: pglite({ dataDir: "memory://" }),
      cors: { origins: ["https://allowed.test"] },
    })
      .schema(s)
      .procedure("ping", (base) => base.handler(async () => "pong"))
      .build();

    const res = await app.handle(
      new Request("http://localhost/rpc/ping", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.test" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("keeps CORS headers on error responses", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: pglite({ dataDir: "memory://" }),
      cors: { origins: ["https://allowed.test"], credentials: true },
    })
      .schema(s)
      .procedure("boom", (base) =>
        base.handler(async () => {
          throw new ORPCError("UNAUTHORIZED", { message: "You must be signed in" });
        }),
      )
      .build();

    const res = await app.handle(
      new Request("http://localhost/rpc/boom", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://allowed.test" },
        body: JSON.stringify({ json: {} }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.test");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("responds to a preflight OPTIONS request", async () => {
    const app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: pglite({ dataDir: "memory://" }),
      cors: { origins: ["https://allowed.test"] },
    })
      .schema(s)
      .build();

    const res = await app.handle(
      new Request("http://localhost/rpc/ping", {
        method: "OPTIONS",
        headers: {
          origin: "https://allowed.test",
          "access-control-request-method": "POST",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.test");
  });
});

describe("db: custom dialect", () => {
  test("accepts a caller-provided Kysely dialect + kind", async () => {
    const dialect = new PGliteDialect({ pglite: new PGlite() });
    const app = new Outer({
      name: "Test",
      baseUrl: "http://localhost",
      db: { dialect, kind: "postgres" },
    })
      .schema(s)
      .resource("post")
      .build();

    const { error } = await app.migrator.migrateToLatest();
    expect(error).toBeUndefined();

    const created = await app.handle(
      new Request("http://localhost/rpc/post/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { title: "hello" } }),
      }),
    );
    expect(created.status).toBe(200);
    expect(((await created.json()) as any).json.title).toBe("hello");
  });
});

describe("auth context", () => {
  const authSchema = schema("1.0.0").auth().build();
  const SECRET = "test-secret-that-is-long-enough";

  function makeAuthed(build: (o: any) => any) {
    const app = build(
      new Outer({ baseUrl: "http://localhost", db: pglite({ dataDir: "memory://" }) })
        .schema(authSchema)
        .auth({ secret: SECRET, emailAndPassword: { enabled: true } }),
    ).build();
    return app;
  }

  async function signUp(app: any, email: string) {
    const res = await app.handle(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password1234", name: email }),
      }),
    );
    return (res.headers.getSetCookie?.() ?? []).map((c: string) => c.split(";")[0]).join("; ");
  }

  function call(app: any, name: string, cookie?: string) {
    return app.handle(
      new Request(`http://localhost/rpc/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ json: {} }),
      }),
    );
  }

  test("context.user is populated without a getSession middleware", async () => {
    const app = makeAuthed((o: any) =>
      o.procedure("me", (base: any) =>
        base.handler(({ context }: any) => ({
          email: context.user?.email ?? null,
          hasSession: context.session != null,
        })),
      ),
    );
    await app.migrator.migrateToLatest();
    const cookie = await signUp(app, "ctx@example.com");

    const { json } = await (await call(app, "me", cookie)).json();
    expect(json.email).toBe("ctx@example.com");
    expect(json.hasSession).toBe(true);
  });

  test("context.user is null for anonymous callers", async () => {
    const app = makeAuthed((o: any) =>
      o.procedure("me", (base: any) =>
        base.handler(({ context }: any) => ({ user: context.user, session: context.session })),
      ),
    );
    await app.migrator.migrateToLatest();
    const { json } = await (await call(app, "me")).json();
    expect(json.user).toBeNull();
    expect(json.session).toBeNull();
  });

  test("the session is resolved once per request, not per procedure", async () => {
    let lookups = 0;
    const app = makeAuthed((o: any) =>
      o
        .middleware(async ({ context, next }: any) => {
          if (context.user) lookups++;
          return next();
        })
        .procedure("me", (base: any) => base.handler(({ context }: any) => context.user!.email)),
    );
    await app.migrator.migrateToLatest();
    const cookie = await signUp(app, "once@example.com");
    await call(app, "me", cookie);
    expect(lookups).toBe(1);
  });

  test("raw .route() handlers get the same resolved user", async () => {
    const app = makeAuthed((o: any) =>
      o.route("get", "/whoami", (_event: any, context: any) =>
        Response.json({ email: context.user?.email ?? null }),
      ),
    );
    await app.migrator.migrateToLatest();
    const cookie = await signUp(app, "route@example.com");
    const res = await app.handle(new Request("http://localhost/whoami", { headers: { cookie } }));
    expect((await res.json()).email).toBe("route@example.com");
  });

  test("context.user is null when .auth() was never called", async () => {
    const app = new Outer({ db: pglite({ dataDir: "memory://" }) })
      .schema(s)
      .procedure("me", (base: any) => base.handler(({ context }: any) => context.user))
      .build();
    const { json } = await (await call(app, "me")).json();
    expect(json).toBeNull();
  });
});

describe("procedure permissions", () => {
  // `role` only reaches the session user when Better Auth's admin plugin is registered

  const authSchema = schema("1.0.0").auth().build();
  const SECRET = "test-secret-that-is-long-enough";

  function makeApp(permission: any, roles?: string[]) {
    return new Outer({ baseUrl: "http://localhost", db: pglite({ dataDir: "memory://" }) })
      .schema(authSchema)
      .auth({ secret: SECRET, emailAndPassword: { enabled: true }, plugins: [betterAuthAdmin()] })
      .procedure("secret", (base: any) => base.handler(() => "ok"), {
        permission,
        ...(roles && { roles }),
      })
      .build();
  }

  async function signUp(app: any, email: string, role?: string) {
    const res = await app.handle(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password1234", name: email }),
      }),
    );
    if (role) await app.db.updateTable("user").set({ role }).where("email", "=", email).execute();
    return (res.headers.getSetCookie?.() ?? []).map((c: string) => c.split(";")[0]).join("; ");
  }

  function call(app: any, cookie?: string) {
    return app.handle(
      new Request("http://localhost/rpc/secret", {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ json: {} }),
      }),
    );
  }

  test("'authenticated' rejects anonymous and allows signed-in callers", async () => {
    const app = makeApp("authenticated");
    await app.migrator.migrateToLatest();
    expect((await call(app)).status).toBe(401);
    const cookie = await signUp(app, "perm@example.com");
    expect((await call(app, cookie)).status).toBe(200);
  });

  test("'admin' rejects a plain user and allows an admin", async () => {
    const app = makeApp("admin");
    await app.migrator.migrateToLatest();
    const user = await signUp(app, "plain@example.com");
    expect((await call(app, user)).status).toBe(403);
    const admin = await signUp(app, "boss@example.com", "admin");
    expect((await call(app, admin)).status).toBe(200);
  });

  test("custom `roles` is respected", async () => {
    const app = makeApp("admin", ["staff"]);
    await app.migrator.migrateToLatest();
    const staff = await signUp(app, "staff@example.com", "staff");
    expect((await call(app, staff)).status).toBe(200);
  });

  test("a function permission receives the context", async () => {
    const app = new Outer({ baseUrl: "http://localhost", db: pglite({ dataDir: "memory://" }) })
      .schema(authSchema)
      .auth({ secret: SECRET, emailAndPassword: { enabled: true }, plugins: [betterAuthAdmin()] })
      .procedure("secret", (base: any) => base.handler(() => "ok"), {
        permission: ({ context }: any) => context.user?.email === "allowed@example.com",
      })
      .build();
    await app.migrator.migrateToLatest();
    const denied = await signUp(app, "denied@example.com");
    expect((await call(app, denied)).status).toBe(403);
    const allowed = await signUp(app, "allowed@example.com");
    expect((await call(app, allowed)).status).toBe(200);
  });

  test("a permission requiring auth without .auth() throws at build()", () => {
    expect(() =>
      new Outer({ db: pglite({ dataDir: "memory://" }) })
        .schema(s)
        .procedure("secret", (base: any) => base.handler(() => "ok"), {
          permission: "authenticated",
        })
        .build(),
    ).toThrow(/require a signed-in session/);
  });

  test("no permission option leaves the procedure public", async () => {
    const app = makeApp(undefined);
    await app.migrator.migrateToLatest();
    expect((await call(app)).status).toBe(200);
  });
});

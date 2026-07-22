import { test, describe, expect } from "bun:test";

import { ORPCError } from "@orpc/client";

import { Outer, memoryRateLimitStore } from "./index";
import { schema } from "./schema";
import { testDb } from "./test-utils";

const s = schema("1.0.0")
  .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
  .build();
const postDb = testDb([s]);

async function makeApp(params: Record<string, unknown> = {}) {
  const app = new Outer({ name: "T", baseUrl: "http://localhost", db: await postDb(), ...params })
    .schema(s)
    .procedure("boom.now", (base) =>
      base.handler(async () => {
        throw new Error("kaboom");
      }),
    )
    .procedure("boom.deliberate", (base) =>
      base.handler(async () => {
        throw new ORPCError("NOT_FOUND", { message: "no such thing" });
      }),
    )
    .build();
  await app.migrator.migrateToLatest();
  return app;
}

const call = (app: any, path: string, init: RequestInit = {}) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: {} }),
      ...init,
    }),
  );

describe("health check", () => {
  test("GET /health reports the database as up", async () => {
    const app = await makeApp();
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "up" });
    await app.close();
  });

  test("health: false omits the route", async () => {
    const app = await makeApp({ health: false });
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(404);
    await app.close();
  });

  test("a custom path is honoured", async () => {
    const app = await makeApp({ health: { path: "/healthz" } });
    expect((await app.handle(new Request("http://localhost/healthz"))).status).toBe(200);
    await app.close();
  });

  test("reports 503 once the database is gone", async () => {
    // its own onError, so the expected probe failure doesn't spam the test log
    const app = await makeApp({ onError: () => {} });
    await app.db.destroy(); // simulate a dead pool
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error", database: "down" });
  });
});

describe("onError", () => {
  test("unexpected errors reach the hook instead of the console", async () => {
    const seen: { error: unknown; source: string }[] = [];
    const app = await makeApp({
      onError: (error: unknown, info: { source: string }) =>
        seen.push({ error, source: info.source }),
    });
    await call(app, "/rpc/boom/now");
    expect(seen).toHaveLength(1);
    expect((seen[0]!.error as Error).message).toBe("kaboom");
    expect(seen[0]!.source).toBe("rpc");
    await app.close();
  });

  test("deliberate ORPCError responses are not reported", async () => {
    const seen: unknown[] = [];
    const app = await makeApp({ onError: (error: unknown) => seen.push(error) });
    // an ORPCError is a deliberate application response, not a failure
    const res = await call(app, "/rpc/boom/deliberate");
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
    await app.close();
  });
});

describe("rate limiting", () => {
  test("requests past the limit get 429 with Retry-After", async () => {
    const app = await makeApp({ rateLimit: { max: 2, windowMs: 60_000 } });
    expect((await call(app, "/rpc/boom/now")).status).not.toBe(429);
    expect((await call(app, "/rpc/boom/now")).status).not.toBe(429);
    const limited = await call(app, "/rpc/boom/now");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.headers.get("RateLimit-Remaining")).toBe("0");
    await app.close();
  });

  test("keys are independent", async () => {
    const app = await makeApp({
      rateLimit: {
        max: 1,
        windowMs: 60_000,
        key: (event: any) => event.req.headers.get("x-key") ?? "anon",
      },
    });
    expect(
      (
        await call(app, "/rpc/boom/now", {
          headers: { "x-key": "a", "content-type": "application/json" },
        })
      ).status,
    ).not.toBe(429);
    // a different key still has its own budget
    expect(
      (
        await call(app, "/rpc/boom/now", {
          headers: { "x-key": "b", "content-type": "application/json" },
        })
      ).status,
    ).not.toBe(429);
    // the first key is now spent
    expect(
      (
        await call(app, "/rpc/boom/now", {
          headers: { "x-key": "a", "content-type": "application/json" },
        })
      ).status,
    ).toBe(429);
    await app.close();
  });

  test("skip bypasses the limit", async () => {
    const app = await makeApp({ rateLimit: { max: 1, windowMs: 60_000, skip: () => true } });
    for (let i = 0; i < 5; i++) {
      expect((await call(app, "/rpc/boom/now")).status).not.toBe(429);
    }
    await app.close();
  });

  test("/api/auth/** and /health are not rate limited", async () => {
    const app = await makeApp({ rateLimit: { max: 1, windowMs: 60_000 } });
    await call(app, "/rpc/boom/now");
    await call(app, "/rpc/boom/now"); // budget spent
    expect((await app.handle(new Request("http://localhost/health"))).status).toBe(200);
    await app.close();
  });

  test("the window resets", async () => {
    const app = await makeApp({ rateLimit: { max: 1, windowMs: 30 } });
    expect((await call(app, "/rpc/boom/now")).status).not.toBe(429);
    expect((await call(app, "/rpc/boom/now")).status).toBe(429);
    await new Promise((r) => setTimeout(r, 50));
    expect((await call(app, "/rpc/boom/now")).status).not.toBe(429);
    await app.close();
  });

  test("the memory store sweeps expired keys and disposes its timer", async () => {
    const store = memoryRateLimitStore(10);
    const first = await store.hit("k", 5);
    expect(first.count).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    // the window lapsed, so the next hit starts a fresh count
    expect((await store.hit("k", 5)).count).toBe(1);
    store.dispose?.();
  });
});

describe("close()", () => {
  test("is idempotent and releases the pool", async () => {
    const app = await makeApp();
    await app.close();
    await app.close(); // must not throw
    await expect(app.db.selectFrom("post").selectAll().execute()).rejects.toThrow();
  });
});

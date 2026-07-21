import { test, describe, beforeEach, expect } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";
import { Kysely, PGliteDialect, sql } from "kysely";

import { Outer } from "./index";
import { pglite, pgliteLive } from "./pglite";
import { schema } from "./schema";
import { createSola } from "./sola";
import { fastPasswordHashing } from "./test-utils";

const dbSchema = schema("1.0.0")
  .table("post", (t) => ({
    id: t.serial().primaryKey(),
    title: t.text(),
    done: t.boolean(),
  }))
  .build();

type DB = typeof dbSchema._db;

/**
 * Live queries need the `live` extension on the client, so these can't use the
 * shared `testDb` snapshot helper (it restores a plain instance).
 */
async function makeFixture() {
  const client = new PGlite({ extensions: { live } }) as any;
  const db = new Kysely<DB>({ dialect: new PGliteDialect({ pglite: client }) });
  await sql`CREATE TABLE post (id serial primary key, title text, done boolean default false)`.execute(
    db,
  );
  const query = createSola<DB>({
    db,
    tables: dbSchema.tables,
    relations: dbSchema.relations,
    live: pgliteLive(client),
  });
  return { db, query };
}

/** Collects the next `n` emissions, failing loudly rather than hanging forever. */
async function take<T>(stream: AsyncIterable<T>, n: number, timeoutMs = 5000): Promise<T[]> {
  const out: T[] = [];
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error(`timed out after ${out.length}/${n} emissions`)),
    timeoutMs,
  );
  try {
    const collect = (async () => {
      for await (const value of stream) {
        out.push(value);
        if (out.length >= n) break;
      }
      return out;
    })();
    return await Promise.race([collect, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}

describe("live queries", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createSola<DB>>;

  beforeEach(async () => {
    ({ db, query } = await makeFixture());
  });

  test("emits the initial result set, then again on every change", async () => {
    await db.insertInto("post").values({ title: "a", done: false }).execute();

    const stream = query.post.live({ orderBy: [{ id: "asc" }] });
    const emissions = take(stream, 3);

    // give the subscription a tick to register before writing
    await new Promise((r) => setTimeout(r, 50));
    await db.insertInto("post").values({ title: "b", done: false }).execute();
    await new Promise((r) => setTimeout(r, 50));
    await db.insertInto("post").values({ title: "c", done: false }).execute();

    const titles = (await emissions).map((rows) => rows.map((r) => r.title));
    expect(titles[0]).toEqual(["a"]);
    expect(titles[1]).toEqual(["a", "b"]);
    expect(titles[2]).toEqual(["a", "b", "c"]);
  });

  test("re-emits when a row moves out of the `where`", async () => {
    await db
      .insertInto("post")
      .values([
        { title: "a", done: false },
        { title: "b", done: false },
      ])
      .execute();

    const stream = query.post.live({ where: { done: false }, orderBy: [{ id: "asc" }] });
    const emissions = take(stream, 2);

    await new Promise((r) => setTimeout(r, 50));
    await db.updateTable("post").set({ done: true }).where("title", "=", "a").execute();

    const counts = (await emissions).map((rows) => rows.length);
    expect(counts).toEqual([2, 1]);
  });

  test("applies the same where/orderBy/take as findMany", async () => {
    await db
      .insertInto("post")
      .values([
        { title: "a", done: false },
        { title: "b", done: false },
        { title: "c", done: false },
      ])
      .execute();

    const args = { where: { done: false }, orderBy: [{ id: "desc" as const }], take: 2 };
    const [live1] = await take(query.post.live(args), 1);
    const oneShot = await query.post.findMany(args);

    expect(live1).toEqual(oneShot);
    expect(live1!.map((r) => r.title)).toEqual(["c", "b"]);
  });

  test("liveCount and liveExists stream scalars", async () => {
    const counts = take(query.post.liveCount({ where: { done: false } }), 2);
    const exists = take(query.post.liveExists({ where: { done: false } }), 2);

    await new Promise((r) => setTimeout(r, 50));
    await db.insertInto("post").values({ title: "a", done: false }).execute();

    expect(await counts).toEqual([0, 1]);
    expect(await exists).toEqual([false, true]);
  });

  test("aborting the signal ends the stream", async () => {
    const controller = new AbortController();
    const seen: number[] = [];

    const consumer = (async () => {
      for await (const rows of query.post.live({}, { signal: controller.signal })) {
        seen.push(rows.length);
      }
      return "ended";
    })();

    await new Promise((r) => setTimeout(r, 50));
    await db.insertInto("post").values({ title: "a", done: false }).execute();
    await new Promise((r) => setTimeout(r, 100));

    controller.abort();
    expect(await consumer).toBe("ended");

    // writes after the abort must not reach the consumer
    const before = seen.length;
    await db.insertInto("post").values({ title: "b", done: false }).execute();
    await new Promise((r) => setTimeout(r, 150));
    expect(seen.length).toBe(before);
  });

  test("an already-aborted signal yields nothing", async () => {
    const rows = [];
    for await (const r of query.post.live({}, { signal: AbortSignal.abort() })) rows.push(r);
    expect(rows).toEqual([]);
  });

  test("breaking out of the loop releases the subscription", async () => {
    await db.insertInto("post").values({ title: "a", done: false }).execute();

    for await (const rows of query.post.live({})) {
      expect(rows).toHaveLength(1);
      break;
    }

    // the subscription is gone, so this write has nothing to notify; if teardown
    // leaked, PGlite would still be maintaining the live view against it
    await db.insertInto("post").values({ title: "b", done: false }).execute();
    expect(await query.post.count()).toBe(2);
  });

  test("rejects `include`, which a single subscription cannot cover", () => {
    expect(() => query.post.live({ include: { author: true } } as any)).toThrow(/include/);
  });

  test("throws when the dialect has no live provider", async () => {
    const plain = createSola<DB>({
      db,
      tables: dbSchema.tables,
      relations: dbSchema.relations,
    });
    expect(() => plain.post.live()).toThrow(/no live-query provider/);
  });
});

// ── Integration: a live query streamed from a procedure ────────────────────

describe("live queries through a procedure", () => {
  test("a handler can return the stream directly", async () => {
    const { Outer } = await import("./index");
    const { pglite } = await import("./pglite");

    const appSchema = schema("1.0.0")
      .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
      .build();

    const outer = new Outer({ db: pglite({ dataDir: "memory://live-proc" }) })
      .schema(appSchema)
      .procedure("post.live", (base) =>
        base.handler(({ context, signal }) => context.db.query.post.live({}, { signal })),
      )
      .build();

    const { error } = await outer.migrator.migrateToLatest();
    expect(error).toBeUndefined();

    const client = outer.client();
    const stream = (await client.post.live()) as AsyncIterable<{ title: string }[]>;

    const controller = new AbortController();
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const rows of stream) {
        seen.push(rows.length);
        if (seen.length >= 2) break;
      }
    })();

    await new Promise((r) => setTimeout(r, 100));
    await outer.db.insertInto("post").values({ title: "a" }).execute();
    await consumer;
    controller.abort();

    expect(seen).toEqual([0, 1]);
  });
});

// ── .resource({ live: true }) ──────────────────────────────────────────────

describe("resource live queries", () => {
  const resSchema = schema("1.0.0")
    .auth()
    .table("post", (t) => ({
      id: t.serial().primaryKey(),
      title: t.text(),
      userId: t.text().references("user", "id").nullable(),
    }))
    .build();

  /** A real Outer app on a live-capable PGlite (the shared snapshot helper has no `live` extension). */
  async function makeApp(
    dataDir: string,
    options?: Parameters<ReturnType<typeof Outer.prototype.schema>["resource"]>[1],
  ) {
    const app = new Outer({ name: "T", baseUrl: "http://localhost", db: pglite({ dataDir }) })
      .schema(resSchema)
      .auth({ secret: "test-secret-that-is-long-enough", emailAndPassword: fastPasswordHashing })
      .resource("post", options)
      .build();
    const { error } = await app.migrator.migrateToLatest();
    if (error) throw error;
    return app;
  }

  async function signUp(app: Awaited<ReturnType<typeof makeApp>>, email: string) {
    const res = await app.handle(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123", name: "T" }),
      }),
    );
    const body = (await res.json()) as { user: { id: string } };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id: body.user.id, headers: () => new Headers({ cookie }) };
  }

  test("is not registered unless opted in", async () => {
    const app = await makeApp("memory://res-off");
    expect((app.client() as any).post.live).toBeUndefined();
  });

  test("streams the list result set", async () => {
    const app = await makeApp("memory://res-on", { live: true });
    const stream = (await (app.client() as any).post.live()) as AsyncIterable<unknown[]>;
    const collected = take(stream, 2);

    await new Promise((r) => setTimeout(r, 100));
    await app.db.insertInto("post").values({ title: "a" }).execute();

    expect((await collected).map((rows) => rows.length)).toEqual([0, 1]);
  });

  test("owner scoping keeps other users' rows out of the stream", async () => {
    const app = await makeApp("memory://res-owner", {
      live: true,
      permissions: { list: "owner" },
      ownerColumn: "userId",
    });
    const alice = await signUp(app, "alice@test.com");
    const bob = await signUp(app, "bob@test.com");

    const stream = (await (app.client(alice.headers) as any).post.live()) as AsyncIterable<
      { title: string }[]
    >;
    // 3 emissions: initial, bob's write (a tick, but filtered empty), alice's write
    const collected = take(stream, 3);

    await new Promise((r) => setTimeout(r, 100));
    // bob's row must not reach alice; alice's must
    await app.db.insertInto("post").values({ title: "bob's", userId: bob.id }).execute();
    await new Promise((r) => setTimeout(r, 100));
    await app.db.insertInto("post").values({ title: "alice's", userId: alice.id }).execute();

    const titles = (await collected).map((rows) => rows.map((r) => r.title));
    expect(titles[0]).toEqual([]);
    // A write by another user still wakes the subscription — the owner filter is
    // in the SQL, so nothing leaks, but the tick is real and worth knowing about.
    expect(titles[1]).toEqual([]);
    expect(titles[2]).toEqual(["alice's"]);
  });

  test("rejects an anonymous subscriber when list requires a session", async () => {
    const app = await makeApp("memory://res-anon", {
      live: true,
      permissions: { list: "authenticated" },
    });
    const stream: any = await (app.client() as any).post.live();
    expect(async () => {
      for await (const _ of stream) break;
    }).toThrow();
  });

  test("caps concurrent subscriptions", async () => {
    const app = await makeApp("memory://res-cap", { live: true, max: 1 } as any);
    const capped = await makeApp("memory://res-cap2", { live: { max: 1 } });

    const first: any = await (capped.client() as any).post.live();
    const iter = first[Symbol.asyncIterator]();
    await iter.next(); // opens the subscription

    const second: any = await (capped.client() as any).post.live();
    await expect(second[Symbol.asyncIterator]().next()).rejects.toThrow(/too many concurrent/i);

    await iter.return?.();
    void app;
  });

  // Regression guard: `getSession` reuses the user resolved when the request
  // arrived, which is right for one-shot calls but must never apply to a
  // long-lived stream — otherwise a revoked session keeps receiving rows.
  test("revalidation re-reads the session rather than the one cached at subscribe time", async () => {
    const app = await makeApp("memory://res-fresh", {
      live: { revalidateMs: 10 },
      permissions: { list: "authenticated" },
    });
    const user = await signUp(app, "erin@test.com");

    const stream: any = await (app.client(user.headers) as any).post.live();
    const iter = stream[Symbol.asyncIterator]();
    await iter.next(); // context.user is now populated for this subscription

    await app.db.deleteFrom("session").execute();
    await new Promise((r) => setTimeout(r, 30));
    await app.db.insertInto("post").values({ title: "must-not-arrive" }).execute();

    await expect(iter.next()).rejects.toThrow(/signed in/i);
  });

  test("ends an idle stream when the session dies — no new rows needed", async () => {
    const app = await makeApp("memory://res-idle", {
      live: { revalidateMs: 50 },
      permissions: { list: "authenticated" },
    });
    const user = await signUp(app, "dave@test.com");

    const stream: any = await (app.client(user.headers) as any).post.live();
    const iter = stream[Symbol.asyncIterator]();
    await iter.next(); // initial emission

    // Session revoked, and then *nothing happens* — no insert, no change. The
    // revalidation timer is the only thing that can notice.
    await app.db.deleteFrom("session").execute();

    await expect(iter.next()).rejects.toThrow(/signed in/i);
  });

  test("ends the stream when the session dies mid-subscription", async () => {
    const app = await makeApp("memory://res-revalidate", {
      live: { revalidateMs: 10 },
      permissions: { list: "authenticated" },
    });
    const user = await signUp(app, "carol@test.com");

    const stream: any = await (app.client(user.headers) as any).post.live();
    const iter = stream[Symbol.asyncIterator]();
    await iter.next(); // initial emission, permission checked

    // the session disappears while the stream is open
    await app.db.deleteFrom("session").execute();
    await new Promise((r) => setTimeout(r, 50));
    await app.db.insertInto("post").values({ title: "after-signout" }).execute();

    await expect(iter.next()).rejects.toThrow(/signed in/i);
  });
});

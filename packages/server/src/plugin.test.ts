import { test, describe, expect } from "bun:test";

import { Outer } from "./index";
import type { OuterPlugin } from "./plugin";
import { schema } from "./schema";
import { testDb } from "./test-utils";

const s = schema("1.0.0")
  .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
  .build();
const db = testDb([s]);

describe("plugin system", () => {
  test("a plugin can add procedures", async () => {
    const plugin: OuterPlugin = {
      name: "test-ping",
      build(ctx) {
        return {
          procedures: {
            ping: ctx.base.handler(() => "pong"),
          },
        };
      },
    };
    const app = new Outer({ db: await db() }).schema(s).use(plugin).build();
    await app.migrator.migrateToLatest();
    const res = await app.handle(
      new Request("http://localhost/rpc/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    await app.close();
  });

  test("a plugin can add routes", async () => {
    const plugin: OuterPlugin = {
      name: "test-route",
      build() {
        return {
          routes: [
            {
              method: "get",
              path: "/custom",
              handler: () => ({ custom: true }),
            },
          ],
        };
      },
    };
    const app = new Outer({ db: await db() }).schema(s).use(plugin).build();
    await app.migrator.migrateToLatest();
    const res = await app.handle(new Request("http://localhost/custom"));
    expect(res.status).toBe(200);
    await app.close();
  });

  test("validate() can reject a build", async () => {
    const plugin: OuterPlugin = {
      name: "needs-auth",
      validate(ctx) {
        if (!ctx.resources.auth) throw new Error("This plugin requires .auth()");
      },
    };
    const outer = new Outer({ db: await db() }).schema(s).use(plugin);
    expect(() => outer.build()).toThrow("This plugin requires .auth()");
  });

  test("duplicate plugin name throws", async () => {
    const plugin: OuterPlugin = { name: "dup" };
    const outer = new Outer({ db: await db() }).use(plugin);
    expect(() => outer.use(plugin)).toThrow('Plugin "dup" is already registered');
  });
});

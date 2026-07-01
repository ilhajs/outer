import { test, describe, expect } from "bun:test";

import { Outer, schema } from "./index";

const s = schema("1.0.0")
  .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
  .build();

function makeOuter() {
  return new Outer({
    name: "Test",
    baseUrl: "http://localhost",
    db: { dataDir: "memory://" },
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
      db: { dataDir: "memory://" },
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
      db: { dataDir: "memory://" },
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

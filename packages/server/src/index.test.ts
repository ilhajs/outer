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

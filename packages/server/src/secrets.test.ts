import { test, describe, expect } from "bun:test";

import { z } from "zod";

import { fromEnv, fromRecord, fromSchema, memorySecrets } from "./secrets";

describe("memorySecrets", () => {
  test("reads set keys, typed to the map's keys", () => {
    const s = memorySecrets({ AUTH_SECRET: "shh" });
    expect(s.get("AUTH_SECRET")).toBe("shh");
    expect(s.all.AUTH_SECRET).toBe("shh");
  });

  test("require throws a clear error for empty values", () => {
    const s = memorySecrets({ SET: "ok", EMPTY: "" });
    expect(s.require("SET")).toBe("ok");
    expect(() => s.require("EMPTY")).toThrow(/Missing required secret "EMPTY"/);
  });
});

describe("fromRecord", () => {
  test("reads from a plain bindings object, keeping per-key types", () => {
    const s = fromRecord({ STRIPE_KEY: "sk_test" });
    expect(s.get("STRIPE_KEY")).toBe("sk_test");
    expect(s.require("STRIPE_KEY")).toBe("sk_test");
  });

  test("a loosely-typed record allows arbitrary keys and returns undefined", () => {
    const s = fromRecord<Record<string, string | undefined>>({ STRIPE_KEY: "sk_test" });
    expect(s.get("NOPE")).toBeUndefined();
    expect(() => s.require("NOPE")).toThrow(/Missing required secret "NOPE"/);
  });
});

describe("fromSchema", () => {
  const Env = z.object({
    AUTH_SECRET: z.string(),
    BASE_URL: z.string().default("http://localhost:8787"),
    CORS_ORIGINS: z
      .string()
      .default("https://a.com,https://b.com")
      .transform((s) => s.split(",").map((o) => o.trim())),
    ADMIN_EMAIL: z.email().optional(),
  });

  test("applies defaults and transforms, exposing a typed `all`", () => {
    const s = fromSchema(Env, { AUTH_SECRET: "shh" });
    expect(s.require("AUTH_SECRET")).toBe("shh");
    expect(s.get("BASE_URL")).toBe("http://localhost:8787");
    // transform ran: CORS_ORIGINS is a string[], not the raw string
    expect(s.all.CORS_ORIGINS).toEqual(["https://a.com", "https://b.com"]);
    expect(s.get("ADMIN_EMAIL")).toBeUndefined();
    // typed access — this line is the type-safety check, not just a runtime one
    const origins: string[] = s.all.CORS_ORIGINS;
    expect(origins).toHaveLength(2);
  });

  test("throws with the failing path when validation fails", () => {
    expect(() => fromSchema(Env, { ADMIN_EMAIL: "not-an-email" })).toThrow(/Invalid environment/);
    expect(() => fromSchema(Env, {})).toThrow(/AUTH_SECRET/);
  });

  test("rejects a schema whose validation is async", () => {
    const Async = z.object({ X: z.string().refine(async () => true) });
    expect(() => fromSchema(Async, { X: "y" })).toThrow(/synchronous schema/);
  });
});

describe("fromEnv", () => {
  test("reads from process.env", () => {
    const key = "OUTER_SECRETS_TEST_KEY";
    process.env[key] = "from-env";
    try {
      expect(fromEnv().get(key)).toBe("from-env");
      expect(fromEnv().require(key)).toBe("from-env");
    } finally {
      delete process.env[key];
    }
  });

  test("does not throw when process is absent", () => {
    const original = globalThis.process;
    try {
      // @ts-expect-error simulating a runtime without a process global
      delete globalThis.process;
      const s = fromEnv();
      expect(s.get("ANYTHING")).toBeUndefined();
      expect(() => s.require("ANYTHING")).toThrow(/Missing required secret/);
    } finally {
      globalThis.process = original;
    }
  });
});

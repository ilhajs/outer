import { test, describe, expect } from "bun:test";

import { pgliteDb } from "./pglite";

describe("pgliteDb", () => {
  test("returns a postgres dialect + kind pair usable as Outer's db param", () => {
    const db = pgliteDb({ dataDir: "memory://" });
    expect(db.kind).toBe("postgres");
    expect(db.dialect).toBeDefined();
  });

  test("skips mkdirSync for memory:// data dirs", () => {
    expect(() => pgliteDb({ dataDir: "memory://" })).not.toThrow();
  });
});

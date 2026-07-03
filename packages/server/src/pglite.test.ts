import { test, describe, expect } from "bun:test";

import { pglite } from "./pglite";

describe("pglite", () => {
  test("returns a postgres dialect + kind pair usable as Outer's db param", () => {
    const db = pglite({ dataDir: "memory://" });
    expect(db.kind).toBe("postgres");
    expect(db.dialect).toBeDefined();
  });

  test("skips mkdirSync for memory:// data dirs", () => {
    expect(() => pglite({ dataDir: "memory://" })).not.toThrow();
  });
});

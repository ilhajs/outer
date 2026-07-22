import { test, describe, beforeAll, expect } from "bun:test";

import { apiKey } from "@better-auth/api-key";
import { z } from "zod/v4";

import { Outer, mcp } from "./index";
import { schema } from "./schema";
import { fastPasswordHashing, testDb } from "./test-utils";

const s = schema("1.0.0")
  .auth({ apiKeys: true })
  .table("post", (t) => ({ id: t.serial().primaryKey(), title: t.text() }))
  .build();
const mcpDb = testDb([s]);

let app: any;
let cookie: string;
let plaintextKey: string;

/** JSON-RPC call against the MCP endpoint. */
async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await app.handle(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  app = new Outer({ name: "MCP Test", baseUrl: "http://localhost", db: await mcpDb() })
    .schema(s)
    .auth({
      secret: "test-secret",
      emailAndPassword: fastPasswordHashing,
      plugins: [
        apiKey({
          // Off by default — without it a key never resolves to a session.
          enableSessionForAPIKeys: true,
          // MCP clients send `Authorization: Bearer <key>`; strip the scheme.
          customAPIKeyGetter: (ctx: any) => {
            const header = ctx.headers?.get("authorization");
            return header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
          },
        }),
      ],
    })
    .procedure(
      "post.search",
      (base) =>
        base
          .meta(mcp.tool({ description: "Search posts by title" }))
          .input(z.object({ q: z.string() }))
          .handler(async ({ input, context }) => {
            const rows = await context.db
              .selectFrom("post")
              .selectAll()
              .where("title", "like", `%${input.q}%`)
              .execute();
            return { count: rows.length, caller: (context as any).user?.email ?? null };
          }),
      { permission: "authenticated" },
    )
    // deliberately untagged — must never appear over MCP
    .procedure("post.secret", (base) => base.handler(async () => ({ ok: true })))
    .mcp()
    .build();
  await app.migrator.migrateToLatest();

  const signUp = await app.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "mcp@test.com", password: "password123", name: "N" }),
    }),
  );
  cookie = signUp.headers
    .getSetCookie()
    .map((c: string) => c.split(";")[0])
    .join("; ");
  await app.db.insertInto("post").values({ title: "hello world" }).execute();

  const created = await app.handle(
    new Request("http://localhost/api/auth/api-key/create", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "mcp-client" }),
    }),
  );
  plaintextKey = ((await created.json()) as any).key;
});

describe(".mcp()", () => {
  test("an API key issued by Better Auth is returned once, in plaintext", () => {
    expect(typeof plaintextKey).toBe("string");
    expect(plaintextKey.length).toBeGreaterThan(10);
  });

  test("tools/list advertises only the tagged procedure", async () => {
    const { body } = await rpc("tools/list", {}, { authorization: `Bearer ${plaintextKey}` });
    const names = (body.result?.tools ?? []).map((t: any) => t.name);
    // dots are not legal in MCP tool names, so `post.search` is exposed as `post_search`
    expect(names).toContain("post_search");
    // untagged procedures, and every _admin/file route, stay invisible
    expect(names).not.toContain("post_secret");
  });

  test("a tool call authenticates as the key's owner", async () => {
    const { body } = await rpc(
      "tools/call",
      { name: "post_search", arguments: { q: "hello" } },
      { authorization: `Bearer ${plaintextKey}` },
    );
    // without an `.output()` schema the payload arrives as JSON text content
    const result = JSON.parse(body.result.content[0].text);
    expect(result.count).toBe(1);
    expect(result.caller).toBe("mcp@test.com"); // the key resolved to its owning user
  });

  test("without a key the permissioned tool is rejected", async () => {
    const { body } = await rpc("tools/call", {
      name: "post_search",
      arguments: { q: "hello" },
    });
    const failed = body.error || body.result?.isError;
    expect(failed).toBeTruthy();
  });

  test("an untagged procedure cannot be called over MCP", async () => {
    const { body } = await rpc(
      "tools/call",
      { name: "post_secret", arguments: {} },
      { authorization: `Bearer ${plaintextKey}` },
    );
    expect(body.error || body.result?.isError).toBeTruthy();
  });
});

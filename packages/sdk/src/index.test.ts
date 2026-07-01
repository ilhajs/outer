import { test, describe, expect, afterEach } from "bun:test";

import { createClient } from "./index";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url =
      input instanceof URL ? input.href : input instanceof Request ? input.url : String(input);
    calls.push(url);
    return new Response(JSON.stringify({ json: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

describe("createClient", () => {
  test(".auth() calls hit Better Auth's REST endpoints, not the RPC router", async () => {
    const calls = mockFetch();
    const client = createClient<any>({ baseUrl: "http://localhost:3000" }).auth().build();

    await (client.auth as any).emailOtp.sendVerificationOtp({ email: "a@b.com", type: "sign-in" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("http://localhost:3000/api/auth/email-otp/send-verification-otp");
  });

  test("RPC calls are unaffected by .auth() being enabled", async () => {
    const calls = mockFetch();
    const client = createClient<any>({ baseUrl: "http://localhost:3000" }).auth().build();

    await (client as any).foo.bar({ x: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("http://localhost:3000/rpc/foo/bar");
  });
});

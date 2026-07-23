import { apiKeyClient } from "@better-auth/api-key/client";
import { createClient } from "@outerjs/sdk";
import type { OuterAdminRouter } from "@outerjs/server";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * Reachability probe: calls `_admin.meta`, which Hub relies on everywhere.
 * An oRPC-level error still counts as reachable — a 401/403 just means we're
 * not signed in yet, but the admin endpoint answered, so it *is* an Outer
 * instance with `.admin()` enabled. `NOT_FOUND` or a network/CORS failure
 * means there's nothing usable at the URL.
 */
export async function pingInstance(baseUrl: string): Promise<boolean> {
  try {
    await getClient(baseUrl)._admin.meta();
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" && code !== "NOT_FOUND";
  }
}

export function getClient(baseUrl: string) {
  return createClient<OuterAdminRouter>({
    baseUrl,
    credentials: "include",
  })
    .auth({ plugins: [emailOTPClient(), apiKeyClient()] })
    .build();
}

import { createClient } from "@outerjs/sdk";
import type { OuterAdminRouter } from "@outerjs/server";
import { emailOTPClient } from "better-auth/client/plugins";

export function getClient(baseUrl: string) {
  return createClient<OuterAdminRouter>({
    baseUrl,
    credentials: "include",
  })
    .auth({ plugins: [emailOTPClient()] })
    .build();
}

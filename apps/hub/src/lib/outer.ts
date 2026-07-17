import { createClient } from "@outerjs/sdk";
import type { OuterAdminRouter } from "@outerjs/server";

export const client = createClient<OuterAdminRouter>({
  baseUrl: "http://localhost:3000",
  // send the session cookie cross-origin — the instance must allow this origin in its CORS_ORIGINS
  credentials: "include",
})
  .auth()
  .build();

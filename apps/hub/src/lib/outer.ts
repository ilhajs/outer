import { createClient } from "@outerjs/sdk";
import type { OuterAdminRouter } from "@outerjs/server";

export const client = createClient<OuterAdminRouter>({
  baseUrl: "http://localhost:3000",
  // the Outer server is on another origin — send the session cookie along
  credentials: "include",
})
  .auth()
  .build();

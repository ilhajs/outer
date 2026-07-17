import { createClient } from "@outerjs/sdk";
import type { OuterAdminRouter } from "@outerjs/server";

export const client = createClient<OuterAdminRouter>({
  baseUrl: "http://localhost:3000",
})
  .auth()
  .build();

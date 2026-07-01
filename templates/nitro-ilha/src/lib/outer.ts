import { createClient } from "@outerjs/sdk";
import type { Router } from "../server";

export const client = createClient<Router>({
  baseUrl: import.meta.env.VITE_APP_URL!,
})
  .auth()
  .build();

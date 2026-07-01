import { createClient } from "@outerjs/sdk";
import { emailOTPClient } from "better-auth/client/plugins";

import type { Router } from "../server";

// Prefer the actual browser origin over VITE_APP_URL — on dynamic/preview
// domains (StackBlitz, Vercel previews, etc.) a static env var won't match
// the real origin, which breaks session cookie scoping.
const baseUrl =
  typeof window !== "undefined" ? window.location.origin : import.meta.env.VITE_APP_URL!;

export const client = createClient<Router>({ baseUrl })
  .auth({ plugins: [emailOTPClient()] })
  .build();

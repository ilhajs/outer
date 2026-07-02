import { createClient } from "@outerjs/sdk";
import { emailOTPClient } from "better-auth/client/plugins";

import type { Router } from "../server";

const baseUrl =
  typeof window !== "undefined" ? window.location.origin : import.meta.env.VITE_APP_URL!;

export const client = createClient<Router>({ baseUrl })
  .auth({ plugins: [emailOTPClient()] })
  .build();

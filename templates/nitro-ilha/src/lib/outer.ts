import { createClient } from "@outerjs/sdk";
import { emailOTPClient } from "better-auth/client/plugins";

import type { Router } from "../server";

export const client = createClient<Router>({
  baseUrl: import.meta.env.VITE_APP_URL!,
})
  .auth({ plugins: [emailOTPClient()] })
  .build();

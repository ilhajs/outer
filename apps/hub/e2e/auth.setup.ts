import { test as setup } from "@playwright/test";

import { STATE_PATH, signIn } from "./helpers";

/** Signs in once and saves cookies + localStorage for the main test project. */
setup("authenticate", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STATE_PATH });
});

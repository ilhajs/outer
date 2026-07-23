import { expect, test } from "@playwright/test";

import { INSTANCE_ID, seedInstance, signIn } from "./helpers";

// These tests exercise the auth flow itself, so they start from a clean slate
// instead of the shared signed-in state.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
  await seedInstance(page);
  await page.goto(`/i/${INSTANCE_ID}`);
  await expect(page).toHaveURL(new RegExp(`/i/${INSTANCE_ID}/login$`));
  await expect(page.getByTestId("login-email")).toBeVisible();
});

test("signs in with email OTP and signs out", async ({ page }) => {
  await signIn(page);

  // Sign out via the sidebar kebab menu.
  await page.getByTestId("sidebar-menu").click();
  await page.getByTestId("sign-out").click();

  await expect(page).toHaveURL(new RegExp(`/i/${INSTANCE_ID}/login$`));
  await expect(page.getByTestId("login-email")).toBeVisible();
});

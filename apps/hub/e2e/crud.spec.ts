import { expect, test } from "@playwright/test";

import { INSTANCE_ID } from "./helpers";

/** The `post` table from templates/minimal: serial pk, title, content, userId FK. */
test("create, edit, and delete a post record", async ({ page }) => {
  await page.goto(`/i/${INSTANCE_ID}`);

  // The post.userId FK is required — grab the seeded admin's id off the user grid.
  await page.getByTestId("sidebar-table-user").click();
  const userHref = await page.getByTestId("record-link").first().getAttribute("href");
  const userId = decodeURIComponent(userHref!.split("/r/")[1]!.split("?")[0]!);

  // ── Create ────────────────────────────────────────────────────────────────
  await page.getByTestId("sidebar-table-post").click();
  await page.getByTestId("add-record").click();

  const title = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  await page.getByTestId("field-title").fill(title);
  await page.getByTestId("field-content").fill("created by playwright");
  await page.getByTestId("field-userId").fill(userId);
  await page.getByTestId("record-create").click();

  // Create navigates into the new record's edit pane; the grid shows the row.
  await expect(page).toHaveURL(/\/t\/post\/r\//);
  await expect(page.getByRole("cell", { name: title })).toBeVisible();

  // ── Edit ──────────────────────────────────────────────────────────────────
  const edited = `${title}-v2`;
  await page.getByTestId("field-title").fill(edited);
  await page.getByTestId("record-save").click();

  // The grid re-loads after save and shows the edited title.
  await expect(page.getByRole("cell", { name: edited })).toBeVisible();

  // ── Delete ────────────────────────────────────────────────────────────────
  await page.getByTestId("record-delete").click();
  await page.getByTestId("record-delete-confirm").click();

  // Back on the grid, the row is gone.
  await expect(page).toHaveURL(/\/t\/post(\?|$)/);
  await expect(page.getByRole("cell", { name: edited })).toHaveCount(0);
});

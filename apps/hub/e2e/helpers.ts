import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

export const OUTER_URL = "http://localhost:3199";
export const ADMIN_EMAIL = "admin@e2e.test";
export const INSTANCE_ID = "e2e";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = path.join(here, ".tmp/state.json");
const LOG_PATH = path.join(here, ".tmp/outer.log");

/** OTPs the fixture server has printed so far (`>>>OTP { email, otp: '…' }`). */
export function otpCount(): number {
  try {
    return [...fs.readFileSync(LOG_PATH, "utf8").matchAll(/otp:.*?(\d{4,8})/g)].length;
  } catch {
    return 0;
  }
}

/** Waits for an OTP printed after `previousCount` and returns it. */
export async function waitForOtp(previousCount: number): Promise<string> {
  await expect
    .poll(otpCount, { message: "fixture server never printed a new OTP" })
    .toBeGreaterThan(previousCount);
  const otps = [...fs.readFileSync(LOG_PATH, "utf8").matchAll(/otp:.*?(\d{4,8})/g)];
  return otps.at(-1)![1]!;
}

/** Registers the fixture instance in Hub's localStorage store. */
export async function seedInstance(page: Page): Promise<void> {
  await page.goto("/i");
  await page.evaluate(
    ([id, url]) => {
      localStorage.setItem("appStore", JSON.stringify({ instances: [{ id, name: "E2E", url }] }));
    },
    [INSTANCE_ID, OUTER_URL],
  );
}

/** Full email-OTP sign-in against the fixture instance; lands on the dashboard. */
export async function signIn(page: Page): Promise<void> {
  await seedInstance(page);
  await page.goto(`/i/${INSTANCE_ID}/login`);
  await page.getByTestId("login-email").fill(ADMIN_EMAIL);
  const before = otpCount();
  await page.getByTestId("login-submit").click();
  const otp = await waitForOtp(before);
  await page.getByTestId("login-otp").fill(otp);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("instance-title")).toHaveText("E2E");
}

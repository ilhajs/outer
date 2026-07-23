import { defineConfig, devices } from "@playwright/test";

/**
 * E2E setup: two web servers —
 *  1. a throwaway Outer instance (templates/minimal, fresh PGlite dir per run)
 *  2. the hub Vite dev server
 * The `setup` project signs in once via email OTP (read from the fixture
 * server's log) and saves storage state for the other tests.
 */
export const HUB_PORT = 5199;
export const OUTER_PORT = 3199;

export default defineConfig({
  testDir: "./e2e",
  // The suite shares one Outer instance and one admin account, so tests run
  // serially — parallel OTP requests would race on the log-scraping helper.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${HUB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.tmp/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node e2e/start-server.mjs",
      url: `http://localhost:${OUTER_PORT}/openapi.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `bunx vite --port ${HUB_PORT} --strictPort`,
      url: `http://localhost:${HUB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

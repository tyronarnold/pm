import { defineConfig, devices } from "@playwright/test";
import { TEST_PORT } from "./tests/global-setup";

export default defineConfig({
  testDir: "./tests",
  // Builds the image and starts a throwaway `pm-test` container; removes it afterwards.
  globalSetup: "./tests/global-setup.ts",
  // All tests share the one board of `user` in the test container, so run them one at a time.
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // All tests share the one saved board of `user`, so run them one at a time.
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 430, height: 932 },
    video: { mode: "on", size: { width: 430, height: 932 } },
    screenshot: "only-on-failure",
  },
});

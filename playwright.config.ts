import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm --workspace @forgeflow/web run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: false,
  },
});

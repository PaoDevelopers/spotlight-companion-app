import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3100", launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    env: { DEMO_LOGIN_CODE: "DEMOCODE", DATABASE_URL: "" },
  },
});

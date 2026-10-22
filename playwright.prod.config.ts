import { defineConfig } from "@playwright/test";

// Runs against the real production (standalone) build on Postgres. Build first: `npm run build`.
// Needs PROD_DATABASE_URL. The first-admin login code is read from the server log.
export const LOG = "/var/tmp/pwa-server.log";

export default defineConfig({
  testDir: "./e2e-prod",
  workers: 1,
  use: { baseURL: "http://localhost:3101", launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: {
    command: `sh -c "cd .next/standalone && node server.js > ${LOG} 2>&1"`,
    url: "http://localhost:3101/login",
    reuseExistingServer: false,
    env: { PORT: "3101", DATABASE_URL: process.env.PROD_DATABASE_URL ?? "", CHECKIN_SECRET: "prod-test-secret", ADMIN_EMAILS: "boss@school.edu", NODE_ENV: "production" },
  },
});

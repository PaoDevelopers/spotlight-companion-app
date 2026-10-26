import { defineConfig } from "@playwright/test";

// The existing browser tests, run against the Go server (the single `spotlight` binary).
// Build first: `make`. Run: `npm run test:e2e:go`.
const SECRET = "dev-only-secret-dev-only-secret-dev";
const DB = "/var/tmp/spotlight-e2e.db";

// The test files read these, so they must be set in this (the test) process, not only for the server.
process.env.E2E_BACKEND = "go";
process.env.E2E_SECRET = SECRET;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3100", bypassCSP: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: {
    command: `sh -c "rm -f ${DB} ${DB}-wal ${DB}-shm; exec ./spotlight serve"`,
    url: "http://localhost:3100/readyz",
    reuseExistingServer: false,
    env: {
      PUBLIC_URL: "http://localhost:3100", LISTEN: ":3100", DB_PATH: DB, CHECKIN_SECRET: SECRET,
      DEMO_SEED: "1", DEMO_LOGIN_CODE: "DEMOCODE", AUTH_MODE: "roster",
    },
  },
});

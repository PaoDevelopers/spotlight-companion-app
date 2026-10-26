import { defineConfig } from "@playwright/test";

// Microsoft sign-in tests against the Go server, using the same fake identity provider.
// Run: `npm run test:e2e:go-sso` (build with `make` first).
const DB = "/var/tmp/spotlight-e2e-sso.db";

export default defineConfig({
  testDir: "./e2e-sso",
  workers: 1,
  use: { baseURL: "http://localhost:3102", launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: [
    { command: "node e2e-sso/fake-idp.mjs", url: "http://localhost:3401/keys", reuseExistingServer: false },
    {
      command: `sh -c "rm -f ${DB} ${DB}-wal ${DB}-shm; exec ./spotlight serve"`,
      url: "http://localhost:3102/readyz",
      reuseExistingServer: false,
      env: {
        PUBLIC_URL: "http://localhost:3102", LISTEN: ":3102", DB_PATH: DB, CHECKIN_SECRET: "dev-only-secret-dev-only-secret-dev",
        AUTH_MODE: "entra", OIDC_TENANT_ID: "test-tenant", OIDC_CLIENT_ID: "client-e2e",
        OIDC_AUTHORIZE_URL: "http://localhost:3401/authorize", OIDC_JWKS_URL: "http://localhost:3401/keys",
        OIDC_ISSUER: "http://localhost:3401/v2.0", ADMIN_EMAILS: "boss@ykpaoschool.cn",
      },
    },
  ],
});

import { defineConfig } from "@playwright/test";

// Microsoft sign-in end to end against a fake identity provider. Run: npm run test:e2e:sso
export default defineConfig({
  testDir: "./e2e-sso",
  workers: 1,
  use: { baseURL: "http://localhost:3102", launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: [
    { command: "node e2e-sso/fake-idp.mjs", url: "http://localhost:3401/keys", reuseExistingServer: false },
    {
      command: "npx next dev -p 3102",
      url: "http://localhost:3102/login",
      reuseExistingServer: false,
      env: {
        AUTH_MODE: "entra", OIDC_TENANT_ID: "test-tenant", OIDC_CLIENT_ID: "client-e2e",
        OIDC_AUTHORIZE_URL: "http://localhost:3401/authorize", OIDC_JWKS_URL: "http://localhost:3401/keys",
        OIDC_ISSUER: "http://localhost:3401/v2.0", ADMIN_EMAILS: "boss@ykpaoschool.cn", DATABASE_URL: "",
      },
    },
  ],
});

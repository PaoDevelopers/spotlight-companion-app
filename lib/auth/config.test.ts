import { afterEach, expect, it } from "vitest";
import { oidcConfig } from "./config";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

it("builds the Microsoft addresses from the tenant id alone (matches the tenant's published discovery document)", () => {
  process.env.OIDC_TENANT_ID = "ddd3d26c-b197-4d00-a32d-1ffd84c0c295";
  process.env.OIDC_CLIENT_ID = "client";
  for (const k of ["OIDC_AUTHORIZE_URL", "OIDC_JWKS_URL", "OIDC_ISSUER"]) delete process.env[k];
  const c = oidcConfig();
  expect(c.issuer).toBe("https://login.microsoftonline.com/ddd3d26c-b197-4d00-a32d-1ffd84c0c295/v2.0");
  expect(c.authorize).toBe("https://login.microsoftonline.com/ddd3d26c-b197-4d00-a32d-1ffd84c0c295/oauth2/v2.0/authorize");
  expect(c.jwks).toBe("https://login.microsoftonline.com/ddd3d26c-b197-4d00-a32d-1ffd84c0c295/discovery/v2.0/keys");
});

it("refuses to start sign-in without both ids", () => {
  delete process.env.OIDC_CLIENT_ID;
  process.env.OIDC_TENANT_ID = "t";
  expect(() => oidcConfig()).toThrow(/OIDC_CLIENT_ID/);
});

export const NONCE_COOKIE = "oidc_nonce";

export type AuthMode = "roster" | "entra";

/** `roster` = email + printed code (works before the school's Microsoft IDs exist); `entra` = Microsoft only. */
export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "entra" ? "entra" : "roster";
}

const clean = (v: string | undefined) => v?.trim() || undefined;

/**
 * Microsoft Entra ID settings. Only the tenant and client IDs are required: like the school's CCA
 * app, we verify the signed ID token against the tenant's published keys, so there is no client
 * secret. The URL overrides exist for tests and other OpenID providers.
 */
export function oidcConfig() {
  const tenant = clean(process.env.OIDC_TENANT_ID);
  const client = clean(process.env.OIDC_CLIENT_ID);
  if (!tenant || !client) throw new Error("AUTH_MODE=entra needs OIDC_TENANT_ID and OIDC_CLIENT_ID");
  const base = `https://login.microsoftonline.com/${tenant}`;
  return {
    client,
    authorize: clean(process.env.OIDC_AUTHORIZE_URL) ?? `${base}/oauth2/v2.0/authorize`,
    jwks: clean(process.env.OIDC_JWKS_URL) ?? `${base}/discovery/v2.0/keys`,
    issuer: clean(process.env.OIDC_ISSUER) ?? `${base}/v2.0`,
    // Email domains of the school; staff and students are separate namespaces.
    staffDomain: (clean(process.env.STAFF_DOMAIN) ?? "ykpaoschool.cn").toLowerCase(),
    studentDomain: (clean(process.env.STUDENT_DOMAIN) ?? "stu.ykpaoschool.cn").toLowerCase(),
  };
}
export type OidcConfig = ReturnType<typeof oidcConfig>;

/** Full email addresses that get the admin role when they sign in. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** The public site address. Set APP_URL in production: Microsoft only accepts exact, registered redirect addresses. */
export function publicOrigin(req: Request): string {
  const fixed = clean(process.env.APP_URL);
  if (fixed) return fixed.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  return `${req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")}://${host}`;
}

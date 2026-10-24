import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Db } from "../db";
import { users } from "../db/schema";
import type { OidcConfig } from "../auth/config";

export type OidcErrorCode = "token" | "nonce" | "bad_email" | "domain";

export class OidcError extends Error {
  constructor(public code: OidcErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

/** Messages for the codes above; the callback passes only a code in the URL, never free text. */
export const SIGNIN_ERRORS: Record<string, string> = {
  external: "Sign-in failed at Microsoft. Please try again.",
  expired: "Sign-in session expired. Please try again.",
  token: "Microsoft's sign-in response could not be verified.",
  nonce: "This sign-in did not match the one that started. Please try again.",
  bad_email: "Your account has no usable email address.",
  domain: "Please sign in with a school account.",
};

/** The page that asks Microsoft to sign the user in and post an ID token back to `redirectUri`. */
export function buildAuthorizeUrl(cfg: OidcConfig, redirectUri: string, nonce: string, state: string) {
  const u = new URL(cfg.authorize);
  u.searchParams.set("client_id", cfg.client);
  u.searchParams.set("response_type", "id_token");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_mode", "form_post");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("state", state);
  return u.toString();
}

const g = globalThis as unknown as { __jwks?: Map<string, JWTVerifyGetKey> };
/** Fetches and caches the tenant's signing keys (jose refreshes them when a new key id appears). */
export function remoteKeys(cfg: OidcConfig): JWTVerifyGetKey {
  const cache = (g.__jwks ??= new Map<string, JWTVerifyGetKey>());
  let k = cache.get(cfg.jwks);
  if (!k) cache.set(cfg.jwks, (k = createRemoteJWKSet(new URL(cfg.jwks))));
  return k;
}

const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks the signature (RS256 only), issuer, audience (must be OUR client id, so tokens minted for other
 * apps in the tenant are refused), expiry, and that the nonce is the one this sign-in started with.
 */
export async function verifyIdToken(idToken: string, cfg: OidcConfig, nonce: string, getKey: JWTVerifyGetKey = remoteKeys(cfg)) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, getKey, { issuer: cfg.issuer, audience: cfg.client, algorithms: ["RS256"], clockTolerance: 60 }));
  } catch (e) {
    throw new OidcError("token", (e as Error).message);
  }
  if (typeof payload.nonce !== "string" || !sameString(payload.nonce, nonce)) throw new OidcError("nonce");

  const raw = [payload.email, payload.preferred_username].find((v): v is string => typeof v === "string" && v.includes("@"));
  const email = raw?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new OidcError("bad_email");
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : email.split("@")[0];
  return { email, name };
}

/** Student domain -> student, staff domain -> teacher, anything else is refused. Exact match: no subdomain tricks. */
export function roleForEmail(email: string, cfg: Pick<OidcConfig, "staffDomain" | "studentDomain">) {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain === cfg.studentDomain) return "student" as const;
  if (domain === cfg.staffDomain) return "teacher" as const;
  return null;
}

/**
 * First sign-in creates the account from the school email. Existing accounts keep their role (an admin
 * may have promoted them); addresses in ADMIN_EMAILS are always admins.
 */
export async function provisionUser(db: Db, who: { email: string; name: string }, cfg: OidcConfig, admins: string[]) {
  const role = roleForEmail(who.email, cfg);
  if (!role) throw new OidcError("domain");
  const isAdmin = admins.includes(who.email);

  const [existing] = await db.select().from(users).where(eq(users.email, who.email));
  if (!existing) {
    const [created] = await db.insert(users).values({ email: who.email, name: who.name, role: isAdmin ? "admin" : role }).returning();
    return created;
  }
  const patch: Partial<typeof users.$inferInsert> = {};
  if (existing.name !== who.name) patch.name = who.name;
  if (isAdmin && existing.role !== "admin") patch.role = "admin";
  if (!Object.keys(patch).length) return existing;
  const [updated] = await db.update(users).set(patch).where(eq(users.id, existing.id)).returning();
  return updated;
}

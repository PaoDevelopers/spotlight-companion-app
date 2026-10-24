import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { NONCE_COOKIE, authMode, oidcConfig, publicOrigin } from "@/lib/auth/config";
import { buildAuthorizeUrl } from "@/lib/services/oidc";

export const dynamic = "force-dynamic";

// Same-site relative paths only, so the post-login redirect can't be turned into an open redirect.
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");

/** Starts a Microsoft sign-in: remember a one-time nonce, then send the browser to Microsoft. */
export async function GET(req: Request) {
  if (authMode() !== "entra") return new Response("Not found", { status: 404 });
  const cfg = oidcConfig();
  const nonce = randomBytes(24).toString("base64url");
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  // state = nonce.next ; the nonce is checked against the cookie AND the signed token on the way back.
  const state = `${nonce}.${Buffer.from(next).toString("base64url")}`;
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, `${publicOrigin(req)}/auth`, nonce, state), 302);
  // SameSite=None: Microsoft posts back from another site, and Lax cookies are not sent on cross-site POSTs.
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 600 });
  return res;
}

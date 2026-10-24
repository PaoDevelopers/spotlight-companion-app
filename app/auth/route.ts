import { NextResponse } from "next/server";
import { NONCE_COOKIE, adminEmails, authMode, oidcConfig, publicOrigin } from "@/lib/auth/config";
import { getDb } from "@/lib/db";
import { OidcError, provisionUser, verifyIdToken } from "@/lib/services/oidc";
import { sessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";
const MAX_BODY = 256 * 1024; // an ID token form is a few KB

const sameSiteNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");

/** Microsoft posts the signed ID token here (response_mode=form_post). */
export async function POST(req: Request) {
  if (authMode() !== "entra") return new Response("Not found", { status: 404 });
  const origin = publicOrigin(req);
  const back = (code: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${code}`, 303);
    res.cookies.delete(NONCE_COOKIE);
    return res;
  };

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("Payload too large", { status: 413 });
  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  if (form.get("error")) return back("external");

  const [nonce, nextB64] = String(form.get("state") ?? "").split(".");
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${NONCE_COOKIE}=`))?.slice(NONCE_COOKIE.length + 1);
  if (!nonce || !cookie || cookie !== nonce) return back("expired");

  const cfg = oidcConfig();
  try {
    const who = await verifyIdToken(String(form.get("id_token") ?? ""), cfg, nonce);
    const user = await provisionUser(await getDb(), who, cfg, adminEmails());
    const next = sameSiteNext(nextB64 ? Buffer.from(nextB64, "base64url").toString() : "/");
    const res = NextResponse.redirect(`${origin}${next}`, 303);
    const c = sessionCookie(user.id);
    res.cookies.set(c.name, c.value, c.options);
    res.cookies.delete(NONCE_COOKIE);
    return res;
  } catch (e) {
    if (e instanceof OidcError) {
      console.warn(`[auth] sign-in refused: ${e.code} ${e.code === "token" ? e.message : ""}`);
      return back(e.code);
    }
    throw e;
  }
}

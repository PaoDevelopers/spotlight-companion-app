import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only (cookie present?) so deep links survive login.
// Real verification happens server-side in requireUser/requireStaff.
export default function proxy(req: NextRequest) {
  if (req.cookies.has("session")) return NextResponse.next();
  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

// Skip static files (anything with an extension: icons, sw.js, manifest) so logged-out browsers can install the PWA.
export const config = { matcher: ["/((?!login|auth|c/|api/|_next/|.*\\..*).*)"] };

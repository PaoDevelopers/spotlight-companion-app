import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only (cookie present?) so deep links survive login.
// Real verification happens server-side in requireUser/requireStaff.
export default function proxy(req: NextRequest) {
  if (req.cookies.has("session")) return NextResponse.next();
  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!login|c/|api/|_next/|manifest.webmanifest|favicon.ico).*)"] };

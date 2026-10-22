import { currentUser, secret } from "@/lib/session";
import { makeEventToken } from "@/lib/checkin/token";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const u = await currentUser();
  if (!u || u.role === "student") return new Response("Forbidden", { status: 403 });
  const id = Number((await params).eventId);
  if (!Number.isInteger(id)) return new Response("Bad request", { status: 400 });
  return Response.json({ token: makeEventToken(secret(), id) }, { headers: { "Cache-Control": "no-store" } });
}

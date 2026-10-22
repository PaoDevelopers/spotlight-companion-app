import { getDb } from "@/lib/db";
import { runAwards } from "@/lib/services/awards";

// Computes DRAFT awards only. A teacher must publish them in /admin/awards.
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) return new Response("Unauthorized", { status: 401 });
  const result = await runAwards(await getDb(), null);
  return Response.json({ ok: true, winners: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length])) });
}

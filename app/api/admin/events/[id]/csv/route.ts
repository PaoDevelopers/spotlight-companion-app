import { currentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { attendees } from "@/lib/services/checkin";

export const dynamic = "force-dynamic";
// Prefix cells that spreadsheets would treat as formulas.
const cell = (v: unknown) => { const s = String(v ?? ""); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u || u.role === "student") return new Response("Forbidden", { status: 403 });
  const rows = await attendees(await getDb(), Number((await params).id));
  const csv = ["name,class,method,time", ...rows.map((r) => [r.name, r.className, r.method, r.at.toISOString()].map(cell).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=attendance.csv" } });
}

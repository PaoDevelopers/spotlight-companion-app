import { getDb } from "./db";
import { requireUser, secret } from "./session";
import { checkInStudent, visitExhibit } from "./services/checkin";

export type ScanResponse = { ok: true; message: string; href?: string } | { ok: false; message: string };

/** Accepts a raw token or a full /c/<token> URL (what the QR/NFC tag encodes). */
export async function processScan(raw: string): Promise<ScanResponse> {
  const user = await requireUser();
  const token = decodeURIComponent(raw.trim()).split("/c/").pop()!.split(/[?#]/)[0];
  const db = await getDb();
  if (token.startsWith("exhibit.")) {
    const r = await visitExhibit(db, secret(), user.id, token);
    return r.ok ? { ok: true, message: "Exhibit visit recorded", href: `/exhibits/${r.slug}` } : { ok: false, message: "That exhibit code isn't valid." };
  }
  const r = await checkInStudent(db, secret(), user.id, token);
  if (r.ok) return { ok: true, message: r.duplicate ? `Already checked in to ${r.title}` : `Checked in to ${r.title}!` };
  const msg = { invalid_token: "That code is invalid or expired. Scan the live screen again.", not_found: "Event not found.", closed: "Check-in isn't open for this event.", full: "This event is full." }[r.error];
  return { ok: false, message: msg };
}

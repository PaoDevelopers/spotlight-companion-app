/** Students can check in from an hour before an event starts until it ends (a teacher can always check anyone in by hand). */
export const CHECKIN_EARLY_MS = 60 * 60 * 1000;

export type CheckinState = { state: "early" | "open" | "over"; opensAt: Date; endsAt: Date };

export function checkinState(startsAt: string, endsAt: string, now = Date.now()): CheckinState {
  const opensAt = new Date(new Date(startsAt).getTime() - CHECKIN_EARLY_MS);
  const end = new Date(endsAt);
  return { state: now < opensAt.getTime() ? "early" : now <= end.getTime() ? "open" : "over", opensAt, endsAt: end };
}

/** "in 2 days", "in 3 hours", "in 12 minutes" */
export function inWords(target: Date, now = Date.now()): string {
  const m = Math.round((target.getTime() - now) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} ${m === 1 ? "minute" : "minutes"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return d <= 90 ? `in ${d} days` : "much later"; // "in 26508 days" helps nobody
}

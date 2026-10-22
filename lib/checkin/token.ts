import { createHmac, timingSafeEqual } from "node:crypto";

export const WINDOW_SECONDS = 30;
// Accept the previous window too so a scan right at rollover still works.
const ACCEPTED_WINDOWS_BACK = 1;

function window(nowMs: number) {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS);
}

function sign(secret: string, eventId: number, w: number) {
  return createHmac("sha256", secret).update(`${eventId}.${w}`).digest("base64url");
}

/** Rotating token shown on the teacher's projector/tablet QR. */
export function makeEventToken(secret: string, eventId: number, nowMs = Date.now()) {
  const w = window(nowMs);
  return `${eventId}.${w}.${sign(secret, eventId, w)}`;
}

/** Returns the event id when the token is authentic and recent, else null. */
export function verifyEventToken(secret: string, token: string, nowMs = Date.now()): number | null {
  const [idStr, wStr, sig] = token.split(".");
  const eventId = Number(idStr);
  const w = Number(wStr);
  if (!Number.isInteger(eventId) || !Number.isInteger(w) || !sig) return null;

  const now = window(nowMs);
  if (w > now || now - w > ACCEPTED_WINDOWS_BACK) return null;

  const expected = Buffer.from(sign(secret, eventId, w));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return eventId;
}

/**
 * Static token for a physical NFC tag / printed exhibit QR. It does not expire,
 * so it only proves "this tag belongs to this event"; uniqueness is enforced by the DB.
 */
export function makeTagToken(secret: string, kind: "event" | "exhibit", id: number) {
  return `${kind}.${id}.${createHmac("sha256", secret).update(`tag.${kind}.${id}`).digest("base64url")}`;
}

export function verifyTagToken(secret: string, token: string): { kind: "event" | "exhibit"; id: number } | null {
  const [kind, idStr, sig] = token.split(".");
  const id = Number(idStr);
  if ((kind !== "event" && kind !== "exhibit") || !Number.isInteger(id) || !sig) return null;
  const expected = Buffer.from(makeTagToken(secret, kind, id));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { kind, id };
}

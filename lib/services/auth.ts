import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { users } from "../db/schema";

export type Role = "student" | "teacher" | "admin";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alike chars

export function generateLoginCode(len = 8) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function hashCode(code: string) {
  const salt = randomBytes(8).toString("hex");
  return `${salt}:${scryptSync(code.toUpperCase(), salt, 32).toString("hex")}`;
}

export function verifyCode(code: string, stored: string | null) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(code.trim().toUpperCase(), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Minimal CSV: header row with name,email,class. Quotes not supported (school rosters rarely need them). */
export function parseRosterCsv(csv: string) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  const idx = (k: string) => header.indexOf(k);
  if (idx("name") < 0 || idx("email") < 0) throw new Error("CSV needs name and email columns");
  return lines.map((l) => {
    const c = l.split(",").map((x) => x.trim());
    return { name: c[idx("name")], email: c[idx("email")].toLowerCase(), className: idx("class") >= 0 ? c[idx("class")] : null };
  }).filter((r) => r.name && r.email.includes("@"));
}

/** Creates/updates students and issues fresh login codes. Returns the plaintext codes ONCE for printing. */
export async function importRoster(db: Db, rows: ReturnType<typeof parseRosterCsv>) {
  const issued: { name: string; email: string; className: string | null; code: string }[] = [];
  for (const r of rows) {
    const code = generateLoginCode();
    await db
      .insert(users)
      .values({ ...r, role: "student", loginCodeHash: hashCode(code) })
      .onConflictDoUpdate({ target: users.email, set: { name: r.name, className: r.className, loginCodeHash: hashCode(code) } });
    issued.push({ ...r, code });
  }
  return issued;
}

export async function loginWithCode(db: Db, email: string, code: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && verifyCode(code, u.loginCodeHash) ? u : null;
}

// --- signed session cookie (swap for Entra later; only createSession's caller changes) ---
const SESSION_DAYS = 45;

export function createSession(secret: string, userId: number, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + SESSION_DAYS * 86400;
  const body = `${userId}.${exp}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readSession(secret: string, token: string | undefined, nowMs = Date.now()): number | null {
  if (!token) return null;
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${id}.${exp}`).digest("base64url"));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < nowMs / 1000) return null;
  return Number(id);
}

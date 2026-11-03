/**
 * The picture to show for an event or exhibit in a list: its cover picture; otherwise the first picture in its text;
 * otherwise nothing (no placeholder). Only addresses the app itself serves or https addresses are used.
 */
const FIRST_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/;

const safe = (u: string) => (u.startsWith("https://") || (u.startsWith("/") && !u.startsWith("//")) ? u : null);

export function coverOf(imageUrl: string | null | undefined, markdown: string | null | undefined): string | null {
  const cover = imageUrl?.trim() ? safe(imageUrl.trim()) : null;
  if (cover) return cover;
  const m = markdown?.match(FIRST_IMAGE);
  return m ? safe(m[1]) : null;
}

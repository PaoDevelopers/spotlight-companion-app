export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const fmtLongDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
/** An ISO time as the value a <input type="datetime-local"> wants (the viewer's local time). */
export function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
/** The reverse: a datetime-local value, read as the viewer's local time, as an ISO string. */
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");

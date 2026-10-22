// Tiny in-memory failure limiter (per server instance). Enough to stop code guessing on a single school server;
// on Vercel each instance counts separately, so it only slows guessing there.
const g = globalThis as unknown as { __fails?: Map<string, number[]> };
const fails = (g.__fails ??= new Map());

export function tooManyFailures(key: string, max = 5, windowMs = 10 * 60_000, now = Date.now()) {
  return (fails.get(key) ?? []).filter((t) => now - t < windowMs).length >= max;
}

export function recordFailure(key: string, windowMs = 10 * 60_000, now = Date.now()) {
  fails.set(key, [...(fails.get(key) ?? []).filter((t) => now - t < windowMs), now]);
}

export function clearFailures(key: string) {
  fails.delete(key);
}

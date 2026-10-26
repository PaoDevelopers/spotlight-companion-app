// Offline support for exhibit pages. The app shell and exhibit data are cached after a visit, so a student can
// read an exhibit with no signal. Check-in and everything personal always need the network.
const CACHE = "spotlight-v1";
const SHELL = "/__shell";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key ?? request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key ?? request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    // hashed file names never change, so the cached copy is always right
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) ?? fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
  } else if (req.mode === "navigate") {
    // pages: remember the app shell; offline, only exhibit pages are served from it
    e.respondWith(
      networkFirst(req, SHELL).catch(() =>
        url.pathname.startsWith("/exhibits")
          ? Promise.reject(new Error("no cached shell"))
          : new Response("You're offline. Open this page once with a connection first.", { status: 503, headers: { "Content-Type": "text/plain" } }),
      ),
    );
  } else if (url.pathname === "/api/exhibits" || url.pathname.startsWith("/api/exhibits/")) {
    e.respondWith(networkFirst(req));
  }
});

// Signing out on a shared phone clears what was cached for that person.
self.addEventListener("message", (e) => {
  if (e.data === "clear") caches.delete(CACHE);
});

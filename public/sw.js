// Offline support for exhibit pages only (network first, cached copy as fallback).
// Check-in and anything personal always needs the network.
const CACHE = "exhibits-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/exhibits")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || new Response("Offline. Open this exhibit once with a connection first.", { status: 503 }))),
  );
});
// Clear cached pages on sign-out so a shared device doesn't keep someone's page.
self.addEventListener("message", (e) => { if (e.data === "clear") caches.delete(CACHE); });

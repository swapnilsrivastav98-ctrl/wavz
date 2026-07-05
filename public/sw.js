self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No offline caching (audio streams live from R2) — this handler exists so
// browsers recognize the app as installable.
self.addEventListener("fetch", () => {});

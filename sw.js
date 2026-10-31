// Minimal service worker: required for Android to treat the site as an installable app (and offer it in the share sheet).
// It does no caching, so deployed updates always load fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

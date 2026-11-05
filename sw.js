// Minimal service worker. Required for Android to treat the site as an installable app (and offer it in the share sheet),
// and it shows the phone notifications. It does no caching, so deployed updates always load fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// A teammate shared something: the Supabase function sends {title, body, id, tag} and we show it, even if the app is closed.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "Standout Moodboard", {
    body: d.body || "A teammate shared something new.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || "moodboard-new",
    renotify: true,
    data: { id: d.id || null },
  }));
});

// Tapping it opens the app on that item (reusing the open window if there is one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.id;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      await w.focus();
      if (id) w.postMessage({ type: "open-item", id });
      return;
    }
    await self.clients.openWindow(id ? "./?open=" + encodeURIComponent(id) : "./");
  })());
});

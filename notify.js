// Notifications.
//  1) While the app is open: a banner slides in ("sabari shared a new reel").
//  2) While the app is closed: a real phone notification (Web Push), sent by the Supabase function notify-new-item.
(() => {
const MB = window.MB;
const { h } = MB;
const sbc = () => MB.sb;
const KEY = (window.CONFIG || {}).VAPID_PUBLIC_KEY || "";
const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const WHAT = (r) => r.type === "video" ? "a new video" : r.type === "image" ? "a new design" : r.type === "link" ? "a new link"
  : /instagram/.test(r.url || "") ? "a new reel" : "a new video";
const openItem = (id) => MB.viewer.open(id);

/* ---------- 1) in-app banner ---------- */
const banner = h("div", { class: "newbanner", hidden: true });
document.body.appendChild(banner);
let bannerTimer;
const hideBanner = () => { banner.hidden = true; clearTimeout(bannerTimer); };
function showBanner(row) {
  const who = MB.nameOf(row.created_by) || row.author || "Someone";
  banner.replaceChildren(
    MB.avatarEl(row.created_by, 34),
    h("div", { class: "grow", on: { click: () => { hideBanner(); openItem(row.id); } } },
      h("strong", {}, `${who} shared ${WHAT(row)}`),
      row.note ? h("div", { class: "muted small" }, row.note.slice(0, 80)) : null),
    h("button", { title: "Dismiss", on: { click: hideBanner } }, "✕"));
  banner.hidden = false;
  try { navigator.vibrate?.(60); } catch {}
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 7000);
}

/* ---------- 2) phone notifications (Web Push) ---------- */
const b64 = (s) => {
  const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};
async function current() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}
async function save(sub) {
  const j = sub.toJSON();
  const { error } = await sbc().from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "user_id,endpoint" });
  if (error) MB.status(error.message, 4000);
}
let pushOn = false;
async function refreshState() {
  pushOn = !!(supported && Notification.permission === "granted" && (await current()).sub);
  return pushOn;
}
async function enable() {
  if (!supported) { MB.status("This browser can't show notifications. Use Chrome on Android.", 5000); return false; }
  if (!KEY) { MB.status("Notifications aren't set up yet. Ask the admin to finish the setup.", 5000); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { MB.status("Notifications are blocked. Allow them in this site's settings.", 5000); return false; }
  const { reg, sub } = await current();
  const s = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY) }));
  await save(s);
  await refreshState();
  MB.status("Notifications are on", 3000);
  return true;
}
async function disable() {
  const { sub } = await current();
  if (sub) { await sbc().from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  await refreshState();
  MB.status("Notifications are off", 3000);
}

function notifyModal() {
  const state = h("p", { class: "muted" }, pushOn ? "Notifications are ON on this phone." : "Notifications are OFF on this phone.");
  const btn = h("button", { class: "primary big", on: { click: async () => {
    if (pushOn) await disable(); else await enable();
    MB.modal.close(); notifyModal();
  } } }, pushOn ? "Turn off" : "Turn on notifications");
  MB.modal.open("Notifications", h("div", { class: "form" },
    h("p", {}, "Get a message like “sabari shared a new reel” whenever a teammate saves something, even when the app is closed."),
    state, btn,
    !supported ? h("p", { class: "warn" }, "This browser can't do phone notifications. Use Chrome on Android, with the app installed.") : null,
    supported && !KEY ? h("p", { class: "warn" }, "The admin still needs to finish the notification setup in Supabase.") : null));
}
MB.menuItems.splice(1, 0, { icon: "🔔", get label() { return "Notifications (" + (pushOn ? "on" : "off") + ")"; }, run: notifyModal });

// one-time offer after sign-in
function maybePrompt() {
  if (!supported || !KEY || Notification.permission !== "default" || localStorage.getItem("mb:np")) return;
  const bar = h("div", { class: "notify-prompt" },
    h("div", { class: "grow" }, h("strong", {}, "Get notified when a teammate shares something?")),
    h("button", { class: "primary", on: { click: async () => { bar.remove(); localStorage.setItem("mb:np", "1"); await enable(); } } }, "Turn on"),
    h("button", { on: { click: () => { bar.remove(); localStorage.setItem("mb:np", "1"); } } }, "Not now"));
  document.body.appendChild(bar);
}

/* ---------- opening an item from a notification ---------- */
function openFromUrl() {
  const id = new URLSearchParams(location.search).get("open");
  if (!id) return;
  history.replaceState(null, "", location.pathname);
  openItem(id);
}
if (supported) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open-item" && e.data.id) openItem(e.data.id); });

MB.notify = { show: showBanner, enable, disable };

/* ---------- start ---------- */
MB.bus.addEventListener("login", async () => {
  sbc().channel("new-items")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "items" }, (p) => {
      const r = p.new;
      if (!r || r.created_by === MB.user.id || r.type === "note" || r.deleted_at) return;
      showBanner(r);
      MB.data.loadNotifs?.();
    }).subscribe();
  if (await refreshState()) save((await current()).sub); // keep this phone's subscription up to date
  maybePrompt();
  openFromUrl();
});
})();

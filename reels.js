// Reels mode: full screen, swipe/scroll through the board's videos one after another.
// Uploaded videos and YouTube autoplay; Instagram blocks autoplay, so those need one tap on ▶.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const D = MB.data;

const root = h("div", { class: "reels", hidden: true });
document.body.appendChild(root);

let list = [], slides = [], idx = -1, muted = false, io = null, scroller = null;
let isOpen = false, pushed = false;
const counter = h("span", { class: "r-count" });
const hint = h("div", { class: "r-hint", hidden: true }, "Tap ▶ to play · swipe the screen edges (or use ▲ ▼) for the next one");

const playable = (r) => r.type === "video" || r.type === "embed";
const kindOf = (r) => (r.type === "video" ? "mp4" : /instagram/.test(r.url) ? "ig" : "emb");
const embedUrl = (r, auto) => r.url + (auto ? (r.url.includes("?") ? "&" : "?") + "autoplay=1&playsinline=1&rel=0" : "");

/* ---------- one slide ---------- */
function buildSlide(r, i) {
  const kind = kindOf(r);
  const media = h("div", { class: "r-media " + kind });
  const rail = h("div", { class: "r-rail" });
  const info = h("div", { class: "r-info" },
    h("div", { class: "r-who" }, MB.avatarEl(r.created_by, 28), h("strong", {}, MB.nameOf(r.created_by) || r.author || ""), h("span", { class: "muted small" }, " " + MB.ago(r.created_at))),
    r.note && h("p", { class: "r-note" }, r.note),
    r.tags?.length ? h("div", { class: "chips" }, r.tags.map((t) => h("span", { class: "tag" }, "#" + t))) : null);
  const el = h("section", { class: "r-slide " + kind },
    media, h("div", { class: "r-edge l" }), h("div", { class: "r-edge r" }), info, rail);
  el.dataset.i = i;
  const s = { r, kind, el, media, rail, node: null, auto: false };
  paintRail(s);
  return s;
}
function mount(s) {
  if (s.node) return;
  if (s.kind === "mp4") s.node = h("video", { src: s.r.url, loop: true, playsInline: true, muted: true, controls: true, preload: "auto" });
  else s.node = h("iframe", { src: embedUrl(s.r, false), allow: "autoplay; fullscreen; picture-in-picture", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" });
  s.media.replaceChildren(s.node);
}
function unmount(s) { if (!s.node) return; s.node = null; s.auto = false; s.media.replaceChildren(); }
function stop(s) {
  if (!s.node) return;
  if (s.kind === "mp4") s.node.pause();
  else if (s.auto) { s.auto = false; s.node.src = embedUrl(s.r, false); } // reload without autoplay so it stops
}
function play(s) {
  if (!s.node) return;
  if (s.kind === "mp4") {
    s.node.muted = muted;
    s.node.play().catch(() => { muted = true; s.node.muted = true; s.node.play().catch(() => {}); paintRail(s); });
  } else if (s.kind === "emb" && !s.auto) { s.auto = true; s.node.src = embedUrl(s.r, true); }
}

function activate(i) {
  slides.forEach((s, j) => {
    if (j === i) { mount(s); play(s); }
    else { stop(s); if (Math.abs(j - i) <= 1) mount(s); else unmount(s); }
  });
  counter.textContent = `${i + 1} / ${slides.length}`;
  hint.hidden = slides[i]?.kind !== "ig";
}

/* ---------- side buttons ---------- */
const rbtn = (icon, count, on, fn) => h("button", { class: "r-btn" + (on ? " on" : ""), on: { click: fn } }, h("span", {}, icon), count ? h("b", {}, String(count)) : null);
function paintRail(s) {
  const r = s.r, counts = D.reactionCounts(r.id), cc = (D.comments.get(r.id) || []).length, fav = D.favs.has(r.id);
  s.rail.replaceChildren(
    rbtn("🔥", counts["🔥"] || "", D.mine(r.id, "🔥"), () => D.toggleReact(r.id, "🔥")),
    rbtn("💬", cc || "", false, () => MB.viewer.open(r.id)),
    rbtn(fav ? "★" : "☆", "", fav, () => D.toggleFav(r.id)),
    r.type === "embed" ? rbtn("↻", "", false, () => MB.replay(s.media)) : null,
    s.kind === "mp4" ? rbtn(muted ? "🔇" : "🔊", "", false, () => { muted = !muted; if (s.node) s.node.muted = muted; slides.forEach(paintRail); }) : null);
}
MB.bus.addEventListener("social-changed", (e) => { if (isOpen) slides.filter((s) => s.r.id === e.detail).forEach(paintRail); });

/* ---------- open / close ---------- */
function go(d) {
  if (!scroller) return;
  const t = Math.max(0, Math.min(slides.length - 1, idx + d));
  scroller.scrollTo({ top: t * scroller.clientHeight, behavior: "smooth" });
}
function open(id) {
  const all = (MB.feedRows?.length ? MB.feedRows : [...MB.items.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))).filter(playable);
  list = all.some((r) => r.id === id) ? all : [MB.items.get(id), ...all].filter(Boolean);
  const start = Math.max(0, list.findIndex((r) => r.id === id));
  if (!list.length) return MB.status("No videos to play yet", 2500);

  slides = list.map(buildSlide);
  scroller = h("div", { class: "r-scroll" }, slides.map((s) => s.el));
  const top = h("div", { class: "r-top" },
    h("button", { class: "r-circle", title: "Close", on: { click: () => close(false) } }, "✕"), counter, h("span", { class: "grow" }),
    h("button", { class: "r-circle", title: "Previous", on: { click: () => go(-1) } }, "▲"),
    h("button", { class: "r-circle", title: "Next", on: { click: () => go(1) } }, "▼"));
  root.replaceChildren(scroller, top, hint);
  root.hidden = false; isOpen = true; idx = -1;
  document.body.classList.add("noscroll");
  root.requestFullscreen?.().catch(() => {}); // hides the phone's status bar where the browser allows it
  if (!pushed) { history.pushState({ reels: 1 }, ""); pushed = true; } // Android Back closes reels, not the app

  requestAnimationFrame(() => {
    scroller.scrollTop = start * scroller.clientHeight;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number(e.target.dataset.i);
        if (i !== idx) { idx = i; activate(i); }
      }
    }, { root: scroller, threshold: 0.6 });
    slides.forEach((s) => io.observe(s.el));
  });
}
function close(fromHistory) {
  if (!isOpen) return;
  isOpen = false;
  io?.disconnect(); io = null;
  slides.forEach((s) => { stop(s); unmount(s); });
  slides = []; list = []; scroller = null; idx = -1;
  root.hidden = true; root.replaceChildren();
  document.body.classList.remove("noscroll");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (pushed) { pushed = false; if (!fromHistory) history.back(); }
}
window.addEventListener("popstate", () => { if (isOpen) { pushed = false; close(true); } });
document.addEventListener("fullscreenchange", () => { if (isOpen && !document.fullscreenElement) close(false); });
window.addEventListener("keydown", (e) => {
  if (!isOpen || document.querySelector(".viewer:not([hidden])")) return;
  if (e.key === "Escape") close(false);
  else if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); go(1); }
  else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  else if (e.key.toLowerCase() === "m") { muted = !muted; slides.forEach((s) => { if (s.node && s.kind === "mp4") s.node.muted = muted; paintRail(s); }); }
});

MB.reels = { open, close };
})();

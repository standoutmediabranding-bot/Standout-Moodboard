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
const hint = h("div", { class: "r-hint", hidden: true }, "Tap ▶ to play · swipe on the top or bottom of the video (or use ▲ ▼) for the next one");

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
  // Instagram/YouTube players swallow swipes that start on them, so give big swipe zones above the player
  // (top, and bottom for Instagram). The middle stays free for the player's own ▶ button.
  const zones = kind === "ig" ? [h("div", { class: "r-zone t" }), h("div", { class: "r-zone b" })] : kind === "emb" ? [h("div", { class: "r-zone t" })] : [];
  const el = h("section", { class: "r-slide " + kind },
    media, h("div", { class: "r-edge l" }), h("div", { class: "r-edge r" }), zones, info, rail);
  el.dataset.i = i;
  const s = { r, kind, el, media, rail, node: null, auto: false };
  paintRail(s);
  return s;
}
function mount(s, active = false) {
  if (s.node) return;
  if (s.kind === "mp4") s.node = h("video", { src: s.r.url, loop: true, playsInline: true, muted: true, controls: true, preload: active ? "auto" : "metadata" }); // neighbours only fetch metadata, to save data
  else s.node = h("iframe", { src: embedUrl(s.r, active && s.kind === "emb"), allow: "autoplay; fullscreen; picture-in-picture", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" });
  s.media.replaceChildren(s.node);
  fitIg(s);
}
// scale factor so Instagram's video (364.5px wide inside its 540px embed) fills this slide's window
// Instagram's video is 364.5 x 648 px inside its 540px embed, starting 87.75px from the left. Scale it so its height fills
// the window, then centre it sideways (on a tall phone it is a little wider than the window, so the edges trim slightly).
function fitIg(s) {
  if (s.kind !== "ig") return;
  const W = s.media.clientWidth, H = s.media.clientHeight;
  if (!W || !H) return;
  const k = H / 648;
  s.media.style.setProperty("--s", String(k));
  s.media.style.setProperty("--ox", (W - 364.5 * k) / 2 - 87.75 * k + "px");
}
window.addEventListener("resize", () => slides.forEach(fitIg));
function unmount(s) { if (!s.node) return; s.node = null; s.auto = false; s.media.replaceChildren(); }
// An iframe can't be paused from outside, so leaving an Instagram/YouTube slide removes its player
// completely. That is what silences its audio; uploaded videos are simply paused.
function stop(s) {
  if (!s.node) return;
  if (s.kind === "mp4") s.node.pause();
  else unmount(s);
}
function play(s) {
  if (!s.node || s.kind !== "mp4") return;
  s.node.muted = muted;
  s.node.play().catch(() => { muted = true; s.node.muted = true; s.node.play().catch(() => {}); paintRail(s); });
}

// the top buttons and the hint fade away after a couple of seconds; a tap or the next video brings them back
let chromeTimer;
function showChrome() {
  root.classList.remove("chrome-hidden");
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => root.classList.add("chrome-hidden"), 2500);
}
root.addEventListener("pointerdown", () => { if (isOpen) showChrome(); }, true);

let actTimer;
function activate(i) {
  showChrome();
  MB.comments?.switchTo(slides[i].r.id); // if the comment panel is open, follow the video you swiped to
  // 1) right away: silence everything that is not the current slide
  slides.forEach((s, j) => {
    if (j === i) return;
    stop(s);
    if (s.kind !== "mp4" || Math.abs(j - i) > 1) unmount(s);
  });
  counter.textContent = `${i + 1} / ${slides.length}`;
  hint.hidden = slides[i]?.kind !== "ig";
  // 2) a moment later (so a fast flick through several slides doesn't load a player for each): start the current one
  clearTimeout(actTimer);
  actTimer = setTimeout(() => {
    if (!isOpen || idx !== i) return;
    mount(slides[i], true); play(slides[i]);
    slides.forEach((s, j) => { if (s.kind === "mp4" && Math.abs(j - i) === 1) mount(s); }); // preload neighbouring uploads
  }, 150);
}

/* ---------- side buttons ---------- */
const rbtn = (icon, count, on, fn) => h("button", { class: "r-btn" + (on ? " on" : ""), on: { click: fn } }, h("span", {}, icon), count ? h("b", {}, String(count)) : null);
function paintRail(s) {
  const r = s.r, counts = D.reactionCounts(r.id), cc = (D.comments.get(r.id) || []).length, fav = D.favs.has(r.id);
  s.rail.replaceChildren(...[
    rbtn("🔥", counts["🔥"] || "", D.mine(r.id, "🔥"), () => D.toggleReact(r.id, "🔥")),
    rbtn("💬", cc || "", false, () => MB.comments.open(r.id)), // a panel over the video, not a second player
    rbtn(fav ? "★" : "☆", "", fav, () => D.toggleFav(r.id)),
    r.type === "embed" ? rbtn("↻", "", false, () => MB.replay(s.media)) : null,
    s.kind === "ig" ? rbtn("📎", "", false, () => MB.attachVideo(s.r, refresh)) : null, // Instagram won't play it: attach the file
    s.kind === "mp4" ? rbtn(muted ? "🔇" : "🔊", "", false, () => { muted = !muted; if (s.node) s.node.muted = muted; slides.forEach(paintRail); }) : null,
  ].filter(Boolean)); // replaceChildren would print null/false as text
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
  if (!isOpen) MB.emit("media-hold", 1); // the feed's own videos/reels go quiet while full screen is open
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
  MB.comments?.close();
  MB.emit("media-hold", -1);
  clearTimeout(chromeTimer);
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

// a card was just turned into an uploaded video: swap its slide in place
function refresh(row) {
  const i = slides.findIndex((s) => s.r.id === row.id);
  if (i < 0) return;
  const old = slides[i];
  io?.unobserve(old.el); stop(old); unmount(old);
  const s = buildSlide(row, i);
  slides[i] = s; list[i] = row;
  old.el.replaceWith(s.el);
  if (idx === i) idx = -1; // lets the observer treat it as newly arrived, so it starts playing
  io?.observe(s.el);
}

MB.reels = { open, close, refresh };
})();

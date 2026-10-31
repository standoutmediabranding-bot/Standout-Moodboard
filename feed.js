// Feed view (best on phones), view toggle, 🔔 what's-new list and the mobile bottom bar.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const D = MB.data;
const app = $("#app");

/* ---------- DOM: feed section, bell, bottom bar ---------- */
["#zoom-out", "#zoom-label", "#zoom-in", "#btn-note"].forEach((s) => $(s).classList.add("canvas-only", "desk"));
["#btn-upload", "#btn-link"].forEach((s) => $(s).classList.add("desk-hide-sm"));
$("header .brand").classList.add("desk");

const viewBtn = h("button", { id: "btn-view", title: "Switch between canvas and feed" });
const bell = h("button", { id: "btn-bell", title: "What's new" }, "🔔", h("b", { class: "badge", hidden: true }));
$("#btn-menu").before(bell);
bell.before(viewBtn);
[viewBtn, bell, $("#btn-menu")].forEach((b) => b.classList.add("desk-hide-sm"));

const typeFilter = { v: "all" };
const FILTERS = [["all", "All"], ["video", "Videos"], ["image", "Images"], ["link", "Links"], ["note", "Notes"], ["fav", "★ Saved"]];
const chipBar = h("div", { class: "chips" });
const sortSel = h("select", {}, [["new", "Newest"], ["old", "Oldest"], ["hot", "Most reactions"]].map(([v, l]) => h("option", { value: v, textContent: l })));
const size = h("input", { type: "range", min: 220, max: 520, step: 10, value: localStorage.getItem("mb:cardw") || 320, title: "Card size" });
const grid = h("div", { class: "feed-grid" });
const feed = h("section", { id: "feed" },
  h("div", { class: "feed-bar" }, chipBar, h("span", { class: "grow" }), sortSel, h("label", { class: "size muted small" }, "Size ", size)),
  grid);
$("#stage").after(feed);

const bar = h("nav", { class: "mbar" },
  h("button", { id: "m-view", on: { click: () => setView(app.dataset.view === "feed" ? "canvas" : "feed") } }),
  h("button", { class: "plus", on: { click: addSheet } }, "＋"),
  h("button", { id: "m-bell", on: { click: showNews } }, "🔔", h("b", { class: "badge", hidden: true })),
  h("button", { on: { click: () => $("#btn-menu").click() } }, "☰"));
app.appendChild(bar);

/* ---------- view switching ---------- */
function setView(v) {
  app.dataset.view = v;
  localStorage.setItem("mb:view", v);
  viewBtn.textContent = v === "feed" ? "▦ Canvas" : "☰ Feed";
  $("#m-view").textContent = v === "feed" ? "▦" : "☰";
  $("#m-view").title = v === "feed" ? "Canvas" : "Feed";
  if (v === "canvas") requestAnimationFrame(() => MB.showCanvas());
  else render();
}
viewBtn.onclick = () => setView(app.dataset.view === "feed" ? "canvas" : "feed");

function addSheet() {
  const big = (icon, label, fn) => h("button", { class: "menu-row big", on: { click: () => { MB.modal.close(); fn(); } } }, h("span", {}, icon), label);
  MB.modal.open("Add to board", h("div", { class: "menu-list" },
    big("🔗", "Save a link (Instagram, YouTube…)", () => MB.compose("")),
    big("📷", "Upload photo or video", () => $("#file-input").click()),
    big("📝", "Add a sticky note", () => $("#btn-note").click())));
}

/* ---------- filters ---------- */
function paintChips() {
  chipBar.replaceChildren(...FILTERS.map(([v, l]) => h("button", { class: "chip" + (typeFilter.v === v ? " on" : ""), on: { click: () => { typeFilter.v = v; paintChips(); render(); } } }, l)));
}
sortSel.onchange = () => render(true);
size.oninput = () => { grid.style.setProperty("--card-w", size.value + "px"); localStorage.setItem("mb:cardw", size.value); };
grid.style.setProperty("--card-w", size.value + "px");
paintChips();

const passes = (r) => {
  const t = typeFilter.v;
  if (t === "fav" && !D.favs.has(r.id)) return false;
  if (t === "video" && !["video", "embed"].includes(r.type)) return false;
  if (["image", "link", "note"].includes(t) && r.type !== t) return false;
  return MB.matches(r, MB.query);
};

/* ---------- cards ---------- */
const cache = new Map(); // id -> {el, sig}
const sigOf = (r) => JSON.stringify([r.type, r.url, r.text, r.note, r.tags, r.status, MB.nameOf(r.created_by)]);

function preview(r) {
  if (r.type === "image") return h("img", { src: r.url, loading: "lazy", alt: "", on: { click: () => MB.viewer.open(r.id) } });
  if (r.type === "video") return h("video", { src: r.url, controls: true, muted: true, loop: true, playsInline: true, preload: "metadata" });
  if (r.type === "embed") {
    const ig = /instagram/.test(r.url);
    // loads by itself as the card scrolls near the screen (loading="lazy"), no tap needed
    return h("div", { class: "embed " + (ig ? "tall" : "wide") },
      h("iframe", { src: r.url, loading: "lazy", allow: "fullscreen; picture-in-picture", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" }));
  }
  if (r.type === "note") return h("div", { class: "bignote", on: { click: () => MB.viewer.open(r.id) } }, r.text || "(empty note)");
  let host = r.url; try { host = new URL(r.url).hostname; } catch {}
  return h("div", { class: "linkcard", on: { click: () => MB.viewer.open(r.id) } }, h("strong", {}, host), h("span", { class: "muted small" }, r.url));
}
function footer(r) {
  const counts = D.reactionCounts(r.id);
  const cc = (D.comments.get(r.id) || []).length;
  return [
    ...D.EMOJIS.map((e) => h("button", { class: "react" + (D.mine(r.id, e) ? " on" : ""), on: { click: () => D.toggleReact(r.id, e) } }, e, counts[e] ? h("b", {}, " " + counts[e]) : null)),
    h("button", { class: "react", on: { click: () => MB.viewer.open(r.id) } }, "💬", cc ? h("b", {}, " " + cc) : null),
    h("span", { class: "grow" }),
    h("button", { class: "react" + (D.favs.has(r.id) ? " on" : ""), title: "Save", on: { click: () => D.toggleFav(r.id) } }, D.favs.has(r.id) ? "★" : "☆"),
  ];
}
function buildCard(r) {
  const foot = h("div", { class: "foot" }, ...footer(r));
  const el = h("article", { class: "card" },
    h("div", { class: "c-head" }, MB.avatarEl(r.created_by, 30),
      h("div", { class: "grow" }, h("strong", {}, MB.nameOf(r.created_by) || r.author || "Someone"), h("div", { class: "muted small" }, MB.ago(r.created_at))),
      r.status && h("span", { class: "chip status" }, { "to-try": "To try", using: "Using now", used: "Used" }[r.status] || r.status)),
    h("div", { class: "c-media " + r.type }, preview(r)),
    (r.note || r.tags?.length) && h("div", { class: "c-note" }, r.note && h("p", {}, r.note),
      h("div", { class: "chips" }, (r.tags || []).map((t) => h("button", { class: "tag", on: { click: () => MB.setQuery("#" + t) } }, "#" + t)))),
    foot);
  el.dataset.id = r.id;
  return { el, foot };
}

let queued = false;
function render(force) {
  if (queued && !force) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (app.dataset.view !== "feed") return;
    let rows = [...MB.items.values()].filter(passes);
    const s = sortSel.value;
    rows.sort((a, b) => s === "old" ? new Date(a.created_at) - new Date(b.created_at)
      : s === "hot" ? Object.values(D.reactionCounts(b.id)).reduce((x, y) => x + y, 0) - Object.values(D.reactionCounts(a.id)).reduce((x, y) => x + y, 0)
      : new Date(b.created_at) - new Date(a.created_at));
    const els = rows.map((r) => {
      const sig = sigOf(r), c = cache.get(r.id);
      if (c && c.sig === sig) return c.el;
      const built = buildCard(r); cache.set(r.id, { el: built.el, sig, foot: built.foot }); return built.el;
    });
    for (const id of [...cache.keys()]) if (!MB.items.has(id)) cache.delete(id);
    const same = els.length === grid.children.length && els.every((e, i) => grid.children[i] === e);
    if (!same) grid.replaceChildren(...els);
    if (!els.length) grid.replaceChildren(h("p", { class: "muted empty-feed" }, MB.items.size ? "Nothing matches your filter." : "Nothing here yet. Tap ＋ to save a reel or upload a video."));
  });
}
MB.bus.addEventListener("items-changed", () => render());
MB.bus.addEventListener("filter", () => render(true));
MB.bus.addEventListener("board-opened", () => { cache.clear(); grid.replaceChildren(); render(true); });
MB.bus.addEventListener("social-changed", (e) => {
  const r = MB.items.get(e.detail), c = cache.get(e.detail);
  if (r && c) c.foot.replaceChildren(...footer(r));
  if (typeFilter.v === "fav" || sortSel.value === "hot") render(true);
});
MB.bus.addEventListener("profiles", () => { cache.clear(); render(true); });

/* ---------- 🔔 what's new ---------- */
function paintBadge() {
  const n = D.notifCount();
  document.querySelectorAll(".badge").forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? "99+" : n; });
}
MB.bus.addEventListener("notifs", paintBadge);
function showNews() {
  const { items, comments } = D.notifs;
  const row = (userId, text, time, id) => h("button", { class: "person news", on: { click: () => { MB.modal.close(); MB.viewer.open(id); } } },
    MB.avatarEl(userId, 34), h("div", { class: "grow" }, h("div", {}, h("strong", {}, MB.nameOf(userId) || "Someone"), " ", text), h("div", { class: "muted small" }, MB.ago(time))));
  const body = h("div", { class: "people" },
    !items.length && !comments.length && h("p", { class: "muted" }, "You're all caught up. 🎉"),
    comments.length > 0 && h("h4", {}, "Replies and mentions"),
    comments.map((c) => row(c.user_id, "commented: " + (c.body.length > 70 ? c.body.slice(0, 70) + "…" : c.body), c.created_at, c.item_id)),
    items.length > 0 && h("h4", {}, "New saves"),
    items.map((i) => row(i.created_by, "saved " + ({ video: "a video", image: "an image", embed: "a reel/video", link: "a link", note: "a note" }[i.type] || "something") + (i.note ? ": " + i.note.slice(0, 60) : ""), i.created_at, i.id)));
  MB.modal.open("What's new", body);
  D.markSeen();
}
bell.onclick = showNews;

// first view: phones start in the feed, desktops on the canvas (runs last so everything above exists)
setView(localStorage.getItem("mb:view") || (matchMedia("(max-width:700px)").matches ? "feed" : "canvas"));
})();

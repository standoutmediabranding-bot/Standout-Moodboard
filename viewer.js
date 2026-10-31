// Full-screen item viewer: big media, note/tags/status, reactions, comments and replies.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const D = MB.data;
const sbc = () => MB.sb;
const STATUSES = [["", "No status"], ["to-try", "To try"], ["using", "Using now"], ["used", "Used in a project"]];

const root = h("div", { class: "viewer", hidden: true });
document.body.appendChild(root);
let current = null;      // item row being shown
let replyTo = null;      // comment being replied to

function origUrl(row) {
  if (row.type === "video" && /^https?:\/\//.test(row.text || "")) return row.text; // video attached to a reel keeps its Instagram link
  const u = row.url || "";
  let m = u.match(/instagram\.com\/reel\/([\w-]+)\/embed/); if (m) return `https://www.instagram.com/reel/${m[1]}/`;
  m = u.match(/youtube-nocookie\.com\/embed\/([\w-]+)/); if (m) return `https://youtu.be/${m[1]}`;
  m = u.match(/player\.vimeo\.com\/video\/(\d+)/); if (m) return `https://vimeo.com/${m[1]}`;
  return MB.safeUrl(u);
}
// Instagram's embed has no replay button, so reload the player to start it over.
function replay(scope) {
  const f = scope?.querySelector("iframe");
  if (!f) return;
  const src = f.src;
  f.src = "about:blank";
  setTimeout(() => (f.src = src), 80);
}
MB.replay = replay;
const boardName = (id) => [...$("#board-select").options].find((o) => o.value === id)?.textContent || "";
const isOwner = () => current && current.created_by === MB.user.id;

function mediaNode(row) {
  if (row.type === "image") return h("img", { src: row.url, alt: "" });
  if (row.type === "video") return h("video", { src: row.url, controls: true, autoplay: true, muted: true, loop: true, playsInline: true });
  if (row.type === "embed") {
    const f = h("iframe", { src: row.url, allow: "fullscreen; picture-in-picture", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" });
    if (/instagram/.test(row.url)) return h("div", { class: "v-ig" }, f); // cropped to the video, header/footer hidden
    f.className = "wide";
    return f;
  }
  if (row.type === "note") return h("div", { class: "bignote" }, row.text || "(empty note)");
  const o = origUrl(row);
  return h("div", { class: "linkcard" }, h("strong", {}, o ? new URL(o).hostname : row.url), h("span", { class: "muted small" }, row.url),
    o && h("a", { class: "btn primary", href: o, target: "_blank", rel: "noopener noreferrer" }, "Open link"));
}

async function save(fields) {
  const { data, error } = await sbc().from("items").update(fields).eq("id", current.id).select().single();
  if (error) return MB.status(error.message, 4000);
  current = data;
  paintSummary();
  if (MB.items.has(data.id)) MB.upsertLocal(data);
  MB.status("Saved", 1200);
}

// Compact summary (note + tags + status). Only the owner gets an "Edit" line, collapsed by default,
// so the comment view isn't crowded with form fields.
const summaryBox = h("div", { class: "summary" });
function paintSummary() {
  if (!current) return;
  const row = current, tags = row.tags || [];
  summaryBox.replaceChildren(...[
    row.note && h("p", { class: "note-text" }, row.note),
    (tags.length || row.status) && h("div", { class: "chips" },
      ...tags.map((t) => h("button", { class: "chip", on: { click: () => { close(); MB.setQuery("#" + t); } } }, "#" + t)),
      row.status && h("span", { class: "chip status" }, STATUSES.find((x) => x[0] === row.status)?.[1] || row.status)),
  ].filter(Boolean));
}
function detailsNode() {
  const row = current;
  paintSummary();
  if (!isOwner()) return h("div", { class: "details" }, summaryBox);
  const tags = row.tags || [];
  const note = h("textarea", { rows: 3, maxLength: 500, value: row.note || "", placeholder: "Why did you save this?", on: { blur: () => { if ((note.value.trim() || null) !== (current.note || null)) save({ note: note.value.trim() || null }); } } });
  const tagIn = h("input", { value: tags.join(", "), placeholder: "tags: hook, transitions", on: { blur: () => {
    const t = [...new Set(tagIn.value.split(/[s,]+/).map((x) => x.replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 8);
    if (t.join() !== (current.tags || []).join()) save({ tags: t });
  } } });
  const st = h("select", { on: { change: () => save({ status: st.value || null }) } }, STATUSES.map(([v, l]) => h("option", { value: v, textContent: l })));
  st.value = row.status || "";
  return h("div", { class: "details" }, summaryBox,
    h("details", { class: "edit" }, h("summary", {}, "✎ Edit note, tags, status"),
      h("div", { class: "form" }, h("label", {}, "Note", note), h("label", {}, "Tags", tagIn), h("label", {}, "Status", st))));
}

/* ---------- reactions bar ---------- */
const reactsBox = h("div", { class: "reacts" });
let moreOpen = false;
function paintReacts() {
  if (!current) return;
  const counts = D.reactionCounts(current.id);
  const fav = D.favs.has(current.id);
  const o = origUrl(current);
  const isVideo = current.type === "embed" || current.type === "video";
  const row = h("div", { class: "react-row" }, ...[
    ...D.EMOJIS.map((e) => h("button", { class: "react" + (D.mine(current.id, e) ? " on" : ""), on: { click: () => D.toggleReact(current.id, e) } }, e, counts[e] ? h("b", {}, " " + counts[e]) : null)),
    isVideo && h("button", { class: "react", title: "Full screen: swipe through videos", on: { click: () => { const id = current.id; close(); MB.reels.open(id); } } }, "⛶"),
    h("span", { class: "grow" }),
    h("button", { class: "react" + (fav ? " on" : ""), title: "Save to my list", on: { click: () => D.toggleFav(current.id) } }, fav ? "★ Saved" : "☆ Save"),
    h("button", { class: "react", title: "More", on: { click: () => { moreOpen = !moreOpen; paintReacts(); } } }, "⋯"),
  ].filter(Boolean));
  const more = moreOpen ? h("div", { class: "more-row" }, ...[
    current.type === "embed" && h("button", { class: "btn", title: "Watch again", on: { click: () => replay(root) } }, "↻ Replay"),
    current.type === "embed" && h("button", { class: "btn", title: "Instagram won't play it here? Attach the video file", on: { click: () => attachVideo(current) } }, "📎 Attach video"),
    o && h("a", { class: "btn", href: o, target: "_blank", rel: "noopener noreferrer" }, "Open original"),
  ].filter(Boolean)) : null;
  reactsBox.replaceChildren(...[row, more].filter(Boolean)); // replaceChildren would print null/false as text
}

/* ---------- comments ---------- */
const listBox = h("div", { class: "comments" });
const input = h("textarea", { rows: 2, maxLength: 2000, placeholder: "Write a comment… use @name to tag someone" });
const replyBar = h("div", { class: "replybar", hidden: true });
const mentionRow = h("div", { class: "chips" });

function bodyNodes(text) {
  const names = new Set([...MB.profiles.values()].map((p) => "@" + p.name.replace(/\s+/g, "").toLowerCase()));
  return text.split(/(@\w+)/g).map((part) => (names.has(part.toLowerCase()) ? h("span", { class: "mention" }, part) : part));
}
function commentNode(c, isReply) {
  const mine = c.user_id === MB.user.id;
  return h("div", { class: "comment" + (isReply ? " reply" : "") },
    MB.avatarEl(c.user_id, 26),
    h("div", { class: "grow" },
      h("div", {}, h("strong", {}, MB.nameOf(c.user_id) || "Someone"), h("span", { class: "muted small" }, "  " + MB.ago(c.created_at))),
      h("div", { class: "body" }, ...bodyNodes(c.body)),
      h("div", { class: "muted small row-actions" },
        !isReply && h("button", { class: "link", on: { click: () => setReply(c) } }, "Reply"),
        mine && h("button", { class: "link", on: { click: () => confirm("Delete this comment?") && D.delComment(c) } }, "Delete"))));
}
function paintComments() {
  if (!current) return;
  const all = D.comments.get(current.id) || [];
  const tops = all.filter((c) => !c.parent_id);
  listBox.replaceChildren(...(tops.length ? tops.flatMap((c) => [commentNode(c, false), ...all.filter((r) => r.parent_id === c.id).map((r) => commentNode(r, true))])
    : [h("p", { class: "muted" }, "No comments yet. Say what you like about this one.")]));
}
function setReply(c) {
  replyTo = c;
  replyBar.hidden = !c;
  replyBar.replaceChildren(...(c ? [`Replying to ${MB.nameOf(c.user_id)}`, h("button", { class: "link", on: { click: () => setReply(null) } }, "✕")] : []));
  if (c) input.focus();
}
async function send() {
  const body = input.value;
  if (!body.trim()) return;
  input.value = "";
  const parent = replyTo?.parent_id || replyTo?.id || null;
  setReply(null);
  await D.addComment(current.id, body, parent);
  listBox.scrollTop = listBox.scrollHeight;
}
input.addEventListener("keydown", (e) => {
  const desktop = matchMedia("(pointer:fine)").matches;
  if (e.key === "Enter" && !e.shiftKey && (desktop || e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});
function paintMentions() {
  const others = [...MB.profiles.values()].filter((p) => p.id !== MB.user.id).slice(0, 8);
  mentionRow.replaceChildren(...others.map((p) => h("button", { type: "button", class: "chip", on: { click: () => {
    input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + p.name.replace(/\s+/g, "") + " "; input.focus();
  } } }, "@" + p.name)));
}

/* ---------- open / close ---------- */
function render() {
  const row = current;
  const media = h("div", { class: "v-media " + row.type }, mediaNode(row));
  const head = h("div", { class: "v-head" }, MB.avatarEl(row.created_by, 34),
    h("div", { class: "grow" }, h("strong", {}, MB.nameOf(row.created_by) || row.author || "Someone"), h("div", { class: "muted small" }, `${MB.ago(row.created_at)} · ${boardName(row.board_id)}`)),
    h("button", { title: "Close", on: { click: close } }, "✕"));
  const side = h("div", { class: "v-side" }, head, detailsNode(), reactsBox,
    h("div", { class: "v-comments" }, listBox,
      h("div", { class: "composer" }, replyBar, input, mentionRow,
        h("button", { class: "primary", on: { click: send } }, "Send"))));
  root.replaceChildren(h("div", { class: "v-backdrop", on: { click: close } }), h("div", { class: "v-panel" }, media, side));
  paintReacts(); paintComments(); paintMentions();
}
async function open(id) {
  let row = MB.items.get(id);
  if (!row) {
    const { data } = await sbc().from("items").select("*").eq("id", id).maybeSingle();
    if (!data || data.deleted_at) return MB.status("That item isn't available any more", 3000);
    row = data; await D.load([id]);
  }
  current = row; replyTo = null; moreOpen = false;
  render();
  // in browser full screen only the full-screen element is visible, so show the viewer inside it
  const host = document.fullscreenElement || document.body;
  if (root.parentNode !== host) host.appendChild(root);
  if (root.hidden) MB.emit("media-hold", 1); // the feed's own videos/reels go quiet while this is open
  root.hidden = false;
  fitVig();
  document.body.classList.add("noscroll");
}
function close() {
  if (!root.hidden) MB.emit("media-hold", -1);
  root.hidden = true; root.replaceChildren(); current = null;
  document.body.classList.remove("noscroll");
}
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });
MB.bus.addEventListener("open-item", (e) => open(e.detail));
MB.bus.addEventListener("social-changed", (e) => { if (current && e.detail === current.id) { paintReacts(); paintComments(); } });
MB.bus.addEventListener("profiles", () => { if (current) { paintComments(); paintMentions(); } });
// Instagram decides per video whether it plays inside an embed. When it won't, attach the video file to the same card.
function attachVideo(row, done) {
  const input = h("input", { type: "file", accept: "video/*" });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > MB.MAX_FILE_MB * 1024 * 1024) return MB.status(`That file is over ${MB.MAX_FILE_MB} MB. Trim or compress it first.`, 5000);
    MB.status("Uploading video…");
    const path = `${row.board_id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await sbc().storage.from(MB.BUCKET).upload(path, f, { contentType: f.type });
    if (up.error) return MB.status("Upload failed: " + up.error.message, 5000);
    const url = sbc().storage.from(MB.BUCKET).getPublicUrl(path).data.publicUrl;
    const dim = await new Promise((res) => {
      const v = document.createElement("video");
      v.preload = "metadata"; v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res({}); v.src = url;
    });
    const w = 280, hh = dim.w && dim.h ? Math.round((w * dim.h) / dim.w) : 500;
    const { data, error } = await sbc().from("items").update({ type: "video", url, path, text: origUrl(row), w, h: hh }).eq("id", row.id).select().single();
    if (error) return MB.status(error.message, 4000);
    MB.status("Video attached. It plays right here now.", 3000);
    if (MB.items.has(row.id)) { MB.removeLocal(row.id); MB.upsertLocal(data); }
    if (current && current.id === row.id) { current = data; render(); }
    done?.(data);
  };
  input.click();
}
MB.attachVideo = attachVideo;
// scale factor so Instagram's video (364.5px wide inside its 540px embed) fills the viewer's window
function fitVig() {
  root.querySelectorAll(".v-ig").forEach((el) => { if (el.clientWidth) el.style.setProperty("--s", String(el.clientWidth / 364.5)); });
}
window.addEventListener("resize", fitVig);
MB.viewer = { open, close };
MB.origUrl = origUrl;

// double-click (or double-tap) a card on the canvas to open it
$("#stage").addEventListener("dblclick", (e) => {
  const el = e.target.closest(".item"); if (!el || e.target.closest("textarea, .del, .rz")) return;
  open(el.dataset.id);
});
})();

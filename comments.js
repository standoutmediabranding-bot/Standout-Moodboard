// Comment panel: slides up OVER the page and leaves the playing video completely untouched
// (no second player, no resizing, no "stay silent" hold), so the video keeps playing while you comment.
(() => {
const MB = window.MB;
const { h } = MB;
const D = MB.data;

const sheet = h("div", { class: "csheet", hidden: true });
document.body.appendChild(sheet);
let itemId = null, replyTo = null;

const title = h("strong", {}, "Comments");
const list = h("div", { class: "csheet-list" });
const replyBar = h("div", { class: "replybar", hidden: true });
const input = h("textarea", { rows: 1, maxLength: 2000, placeholder: "Add a comment…", enterKeyHint: "send", autocapitalize: "sentences" });
const send = h("button", { class: "primary", on: { click: () => submit() } }, "Send");
const mentions = h("div", { class: "chips" });
sheet.append(
  h("div", { class: "csheet-head" }, title, h("span", { class: "grow" }), h("button", { title: "Close", on: { click: () => close() } }, "✕")),
  list, replyBar, h("div", { class: "csheet-compose" }, input, send), mentions);

function bodyNodes(text) {
  const names = new Set([...MB.profiles.values()].map((p) => "@" + p.name.replace(/\s+/g, "").toLowerCase()));
  return text.split(/(@\w+)/g).map((part) => (names.has(part.toLowerCase()) ? h("span", { class: "mention" }, part) : part));
}
function commentNode(c, isReply) {
  const mine = MB.user && c.user_id === MB.user.id;
  return h("div", { class: "comment" + (isReply ? " reply" : "") },
    MB.avatarEl(c.user_id, 26),
    h("div", { class: "grow" },
      h("div", {}, h("strong", {}, MB.nameOf(c.user_id) || "Someone"), h("span", { class: "muted small" }, "  " + MB.ago(c.created_at))),
      h("div", { class: "body" }, ...bodyNodes(c.body)),
      h("div", { class: "muted small row-actions" },
        !isReply && h("button", { class: "link", on: { click: () => setReply(c) } }, "Reply"),
        mine && h("button", { class: "link", on: { click: () => confirm("Delete this comment?") && D.delComment(c) } }, "Delete"))));
}
function paint() {
  if (!itemId) return;
  const all = D.comments.get(itemId) || [];
  const tops = all.filter((c) => !c.parent_id);
  title.textContent = all.length ? `Comments (${all.length})` : "Comments";
  list.replaceChildren(...(tops.length
    ? tops.flatMap((c) => [commentNode(c, false), ...all.filter((r) => r.parent_id === c.id).map((r) => commentNode(r, true))])
    : [h("p", { class: "muted" }, "No comments yet. Say what you like about this one.")]));
}
function setReply(c) {
  replyTo = c;
  replyBar.hidden = !c;
  replyBar.replaceChildren(...(c ? [`Replying to ${MB.nameOf(c.user_id)}`, h("button", { class: "link", on: { click: () => setReply(null) } }, "✕")] : []));
  if (c) input.focus();
}
async function submit() {
  const body = input.value;
  if (!body.trim() || !itemId) return;
  input.value = "";
  const parent = replyTo?.parent_id || replyTo?.id || null;
  setReply(null);
  await D.addComment(itemId, body, parent);
  list.scrollTop = list.scrollHeight;
}
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
function paintMentions() {
  const others = [...MB.profiles.values()].filter((p) => !MB.user || p.id !== MB.user.id).slice(0, 8);
  mentions.replaceChildren(...others.map((p) => h("button", { type: "button", class: "chip", on: { click: () => {
    input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + p.name.replace(/\s+/g, "") + " "; input.focus();
  } } }, "@" + p.name)));
}

// Keep the panel above the phone keyboard WITHOUT resizing the page: the page and the video stay exactly where they are.
function setKeyboardOverlay(on) { try { if (navigator.virtualKeyboard) navigator.virtualKeyboard.overlaysContent = on; } catch {} }
const vv = window.visualViewport;
function updateKb() {
  if (!vv) return;
  const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
  sheet.style.setProperty("--kb", kb + "px");
}
if (vv) { vv.addEventListener("resize", updateKb); vv.addEventListener("scroll", updateKb); }

function open(id) {
  itemId = id; replyTo = null; setReply(null);
  const host = document.fullscreenElement || document.body; // in browser full screen only that element is visible
  if (sheet.parentNode !== host) host.appendChild(sheet);
  sheet.hidden = false;
  setKeyboardOverlay(true);
  updateKb(); paint(); paintMentions();
  if (!(D.comments.get(id) || []).length) D.load([id]);
}
function close() {
  sheet.hidden = true; itemId = null; replyTo = null;
  input.blur(); setKeyboardOverlay(false);
  sheet.style.setProperty("--kb", "0px");
}
function switchTo(id) { if (!sheet.hidden && id !== itemId) { itemId = id; setReply(null); paint(); if (!(D.comments.get(id) || []).length) D.load([id]); } }

MB.bus.addEventListener("social-changed", (e) => { if (!sheet.hidden && e.detail === itemId) paint(); });
MB.bus.addEventListener("profiles", () => { if (!sheet.hidden) { paint(); paintMentions(); } });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden && document.activeElement !== input) close(); });

MB.comments = { open, close, switchTo };
})();

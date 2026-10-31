(() => {
const { SUPABASE_URL, SUPABASE_ANON_KEY, MAX_FILE_MB = 50 } = window.CONFIG || {};
const BUCKET = "media";
const $ = (s) => document.querySelector(s);
const stage = $("#stage"), world = $("#world");

let sb, user = null, board = null, channel = null;
const items = new Map(); // id -> row
const els = new Map();   // id -> element
let view = { x: 0, y: 0, z: 1 };
let selected = null;
let signUpMode = false;
let busy = 0;
let recovery = false;
let needFit = false; // board opened while the canvas was hidden (phone feed view)
let query = "";
const bus = new EventTarget();
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- people ---------- */
const profiles = new Map(); // user id -> {id,name,avatar_url,color}
async function loadProfiles() {
  const { data } = await sb.from("profiles").select("*");
  (data || []).forEach((p) => profiles.set(p.id, p));
  cset("profiles", [...profiles.values()]);
}

/* ---------- instant start: this device remembers the last board, so it shows before the network answers ---------- */
const ck = (k) => `mb:c:${user?.id}:${k}`;
const cget = (k) => { try { return JSON.parse(localStorage.getItem(ck(k))); } catch { return null; } };
const cset = (k, v) => { try { localStorage.setItem(ck(k), JSON.stringify(v)); } catch {} };
const cclear = () => { try { Object.keys(localStorage).filter((k) => k.startsWith("mb:c:")).forEach((k) => localStorage.removeItem(k)); } catch {} };
const nameOf = (uid) => profiles.get(uid)?.name || "";
function avatarEl(uid, size = 22) {
  const p = profiles.get(uid);
  const el = document.createElement("span");
  el.className = "avatar";
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${p?.color || "#888"}`;
  if (p?.avatar_url) { const i = document.createElement("img"); i.src = p.avatar_url; i.alt = ""; el.appendChild(i); }
  else el.textContent = (p?.name || "?")[0].toUpperCase();
  el.title = p?.name || "";
  return el;
}

/* ---------- helpers ---------- */
let toastTimer;
function status(msg, ms = 0) {
  const el = $("#status");
  el.textContent = msg; el.hidden = !msg;
  clearTimeout(toastTimer);
  if (msg && ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const displayName = () => nameOf(user?.id) || (user?.email || "").split("@")[0];
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const VID_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;
function youtubeId(u) {
  try {
    const x = new URL(u);
    if (x.hostname === "youtu.be") return x.pathname.slice(1);
    if (/(^|\.)youtube\.com$/.test(x.hostname)) return x.searchParams.get("v") || (x.pathname.match(/\/(shorts|embed)\/([\w-]{6,})/) || [])[2];
  } catch {}
  return null;
}
function instagramCode(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)instagram\.com$/.test(x.hostname)) return (x.pathname.match(/\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/) || [])[1];
  } catch {}
  return null;
}
function vimeoId(u) {
  try { const x = new URL(u); if (/(^|\.)vimeo\.com$/.test(x.hostname)) return (x.pathname.match(/\/(\d+)/) || [])[1]; } catch {}
  return null;
}

/* ---------- boot ---------- */
// Android share sheet -> manifest share_target opens "/?url=...&text=...". Park the link until we're signed in and a board is open.
function readShare() {
  const p = new URLSearchParams(location.search);
  const raw = ["url", "text", "title"].map((k) => p.get(k)).filter(Boolean).join(" ");
  const m = raw.match(/https?:\/\/[^\s]+/);
  if (m) sessionStorage.setItem("mb:pending", m[0]);
  if (m || p.has("url") || p.has("text")) history.replaceState(null, "", location.pathname);
}
async function flushPending() {
  const u = sessionStorage.getItem("mb:pending");
  if (!u || !board) return;
  sessionStorage.removeItem("mb:pending");
  if (window.MB.compose) return window.MB.compose(u);
  await addUrl(u);
  status("Saved to " + ($("#board-select").selectedOptions[0]?.textContent || "board"), 3500);
}

function init() {
  readShare();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { $("#setup").hidden = false; return; }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.getSession().then(({ data }) => { if (!recovery) setUser(data.session?.user ?? null); });
  sb.auth.onAuthStateChange((e, s) => {
    if (e === "PASSWORD_RECOVERY") { recovery = true; showRecovery(); return; }
    if (!recovery) setUser(s?.user ?? null);
  });
}

function setUser(u) {
  const same = (u?.id ?? null) === (user?.id ?? null);
  user = u;
  $("#auth").hidden = !!u;
  $("#app").hidden = !u;
  if (same && u) return;
  if (u) {
    $("#who").textContent = u.email;
    hydrate();                          // instantly show the last board from this device's memory
    loadBoards();                       // don't wait for profiles: they load in parallel and the cards repaint with names/avatars
    loadProfiles().then(() => { emit("profiles"); emit("login"); });
  }
  else { closeBoard(); cclear(); }
}

/* ---------- auth ---------- */
$("#auth-toggle").onclick = () => {
  signUpMode = !signUpMode;
  $("#auth-submit").textContent = signUpMode ? "Create account" : "Sign in";
  $("#auth-toggle").textContent = signUpMode ? "Have an account? Sign in" : "New here? Create an account";
  $("#password").autocomplete = signUpMode ? "new-password" : "current-password";
};
$("#show-pw").onclick = () => {
  const p = $("#password"), show = p.type === "password";
  p.type = show ? "text" : "password";
  $("#show-pw").textContent = show ? "Hide password" : "Show password";
};
$("#auth-forgot").onclick = async () => {
  const err = $("#auth-error"); err.hidden = false;
  const email = $("#email").value.trim();
  if (!email) { err.textContent = "Type your email above first, then tap Forgot password."; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  err.textContent = error ? error.message : "Reset link sent. Check your email.";
};
function showRecovery() {
  $("#auth").hidden = false; $("#app").hidden = true;
  $("#auth-title").textContent = "Set a new password";
  $("#email").closest("label").hidden = true; $("#email").required = false;
  $("#auth-submit").textContent = "Save password";
  $("#auth-toggle").hidden = true; $("#auth-forgot").hidden = true;
  $("#password").autocomplete = "new-password";
}
$("#auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("#auth-error"); err.hidden = true;
  if (recovery) {
    const { data, error } = await sb.auth.updateUser({ password: $("#password").value });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    recovery = false;
    history.replaceState(null, "", location.pathname);
    location.reload();
    return;
  }
  const creds = { email: $("#email").value.trim().toLowerCase(), password: $("#password").value };
  const { data, error } = signUpMode ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
  if (error) { err.textContent = error.message; err.hidden = false; return; }
  if (signUpMode && !data.session) { err.textContent = "Check your email to confirm, then sign in."; err.hidden = false; }
};
$("#sign-out").onclick = () => sb.auth.signOut();

/* ---------- boards ---------- */
const allBoards = []; // every board incl. archived, for the boards manager
async function loadBoards(selectId, keepOpen) {
  const { data, error } = await sb.from("boards").select("*").order("created_at");
  if (error) return status(error.message, 4000);
  allBoards.splice(0, allBoards.length, ...data);
  let list = data.filter((b) => !b.archived);
  if (!list.length) { const b = await createBoard("My first board"); if (!b) return; list = [b]; allBoards.push(b); }
  const current = board?.id;
  const sel = $("#board-select");
  fillBoardSelect(list);
  cset("boards", list.map((b) => ({ id: b.id, name: b.name })));
  const want = selectId || (keepOpen && current) || localStorage.getItem("mb:last");
  sel.value = list.some((b) => b.id === want) ? want : list[0].id;
  if (sel.value === current) return; // already open (or opening from the device's memory): keep it, don't reload
  openBoard(sel.value);
}
function fillBoardSelect(list) {
  const sel = $("#board-select");
  sel.innerHTML = "";
  for (const b of list) { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); }
}
// Show the last board straight away, and start fetching its cards without waiting for the board list.
function hydrate() {
  const p = cget("profiles");
  if (p) p.forEach((x) => profiles.set(x.id, x));
  const last = localStorage.getItem("mb:last");
  const b = cget("boards");
  if (!b?.length) { if (last) openBoard(last); return; }
  fillBoardSelect(b);
  const id = b.some((x) => x.id === last) ? last : b[0].id;
  $("#board-select").value = id;
  openBoard(id);
}
async function createBoard(name) {
  const { data, error } = await sb.from("boards").insert({ name, created_by: user.id }).select().single();
  if (error) { status(error.message, 4000); return null; }
  return data;
}
$("#new-board").onclick = async () => {
  const name = prompt("Board name?");
  if (!name || !name.trim()) return;
  const b = await createBoard(name.trim());
  if (b) loadBoards(b.id);
};
$("#board-select").onchange = (e) => openBoard(e.target.value);

function closeBoard() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  items.clear(); els.clear(); world.innerHTML = ""; board = null; selected = null;
}

async function openBoard(id) {
  closeBoard();
  board = { id };
  localStorage.setItem("mb:last", id);
  const restoreView = () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("mb:view:" + id)); } catch {}
    if (saved) { view = saved; applyView(); } else if (stage.clientWidth) fit(); else needFit = true;
  };
  const cached = cget("items:" + id);
  if (cached?.length) { cached.forEach(upsertLocal); restoreView(); } // instant: last known cards, refreshed below
  const { data, error } = await sb.from("items").select("*").eq("board_id", id).is("deleted_at", null).order("z");
  if (error) return status(error.message, 4000);
  if (board?.id !== id) return;
  const fresh = new Set(data.map((r) => r.id));
  for (const k of [...items.keys()]) if (!fresh.has(k)) removeLocal(k); // deleted since this device last looked
  data.forEach(upsertLocal);
  cset("items:" + id, data.slice(-200));
  restoreView();
  emit("board-opened", id);
  channel = sb.channel("board-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `board_id=eq.${id}` },
      (p) => { if (p.eventType === "DELETE") return; if (p.new.deleted_at) removeLocal(p.new.id); else upsertLocal(p.new); })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "items" },
      (p) => removeLocal(p.old.id))
    .subscribe();
  flushPending();
}

/* ---------- viewport ---------- */
let saveViewTimer;
function applyView() {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
  stage.style.backgroundSize = `${24 * view.z}px ${24 * view.z}px`;
  $("#zoom-label").textContent = Math.round(view.z * 100) + "%";
  $("#empty").hidden = items.size > 0;
  clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(() => {
    if (board) try { localStorage.setItem("mb:view:" + board.id, JSON.stringify(view)); } catch {}
  }, 300);
}
function zoomAt(cx, cy, factor) {
  const r = stage.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const nz = clamp(view.z * factor, 0.1, 4);
  view.x = px - (px - view.x) * (nz / view.z);
  view.y = py - (py - view.y) * (nz / view.z);
  view.z = nz;
  applyView();
}
function fit() {
  const rows = [...items.values()];
  const r = stage.getBoundingClientRect();
  if (!rows.length) { view = { x: r.width / 2, y: r.height / 2, z: 1 }; return applyView(); }
  const x1 = Math.min(...rows.map((i) => i.x)), y1 = Math.min(...rows.map((i) => i.y));
  const x2 = Math.max(...rows.map((i) => i.x + i.w)), y2 = Math.max(...rows.map((i) => i.y + i.h));
  const pad = 60;
  const z = clamp(Math.min((r.width - pad * 2) / (x2 - x1), (r.height - pad * 2) / (y2 - y1)), 0.1, 1);
  view = { z, x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z };
  applyView();
}
const toWorld = (cx, cy) => {
  const r = stage.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
};
const viewCenter = () => { const r = stage.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
}, { passive: false });
$("#zoom-in").onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); };
$("#zoom-out").onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); };
$("#zoom-label").onclick = fit;

/* ---------- item rendering ---------- */
function buildItem(row) {
  const el = document.createElement("div");
  el.className = "item " + row.type;
  el.dataset.id = row.id;

  const grip = document.createElement("div");
  grip.className = "grip";
  const by = document.createElement("span");
  by.className = "by";
  const del = document.createElement("button");
  del.className = "del"; del.title = "Delete"; del.textContent = "×";
  del.onclick = () => deleteItem(row.id);
  grip.append(by, del);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.onclick = (e) => { const t = e.target.closest(".tag"); if (t) setQuery(t.dataset.tag); else emit("open-item", row.id); };
  el.appendChild(meta);
  el.appendChild(grip);

  if (row.type === "image") {
    const img = document.createElement("img");
    img.src = row.url; img.draggable = false; img.loading = "lazy";
    el.appendChild(img);
  } else if (row.type === "video") {
    const v = document.createElement("video");
    v.src = row.url; v.controls = true; v.loop = true; v.muted = true; v.playsInline = true; v.preload = "metadata";
    el.appendChild(v);
  } else if (row.type === "embed") {
    const f = document.createElement("iframe");
    f.src = row.url; f.allow = "fullscreen; picture-in-picture"; f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin"; // YouTube returns error 153 without a referrer f.loading = "lazy";
    el.appendChild(f);
  } else if (row.type === "link") {
    const a = document.createElement("a");
    a.target = "_blank"; a.rel = "noopener noreferrer"; a.draggable = false;
    const href = safeUrl(row.url);
    if (href) a.href = href;
    const h = document.createElement("span"); h.className = "host";
    h.textContent = href ? new URL(href).hostname : row.url;
    const u = document.createElement("span"); u.className = "url"; u.textContent = row.url;
    a.append(h, u);
    el.appendChild(a);
  } else if (row.type === "note") {
    const t = document.createElement("textarea");
    t.placeholder = "Type a note…";
    let timer;
    t.addEventListener("input", () => {
      const r = items.get(row.id); if (r) r.text = t.value;
      clearTimeout(timer);
      timer = setTimeout(() => sb.from("items").update({ text: t.value }).eq("id", row.id), 600);
    });
    el.appendChild(t);
  }

  const rz = document.createElement("div");
  rz.className = "rz";
  el.appendChild(rz);
  return el;
}

function upsertLocal(row) {
  const prev = items.get(row.id);
  items.set(row.id, row);
  let el = els.get(row.id);
  if (!el) { el = buildItem(row); els.set(row.id, el); world.appendChild(el); }
  if (drag && drag.id === row.id) return; // don't fight the local gesture
  el.style.left = row.x + "px"; el.style.top = row.y + "px";
  el.style.width = row.w + "px"; el.style.height = row.h + "px";
  el.style.zIndex = row.z;
  renderMeta(el, row);
  if (row.type === "note") {
    const t = el.querySelector("textarea");
    if (document.activeElement !== t && t.value !== (row.text || "")) t.value = row.text || "";
  }
  if (!prev) $("#empty").hidden = true;
  emit("items-changed");
}
// credit line, note under the card, tag chips, search dimming
function renderMeta(el, row) {
  const by = el.querySelector(".by");
  by.textContent = "";
  by.append(avatarEl(row.created_by, 16), document.createTextNode(" " + (nameOf(row.created_by) || row.author || "")));
  el.querySelector(".del").hidden = row.created_by !== user?.id;
  const meta = el.querySelector(".meta");
  meta.textContent = "";
  meta.hidden = row.type === "note" || !(row.note || row.tags?.length);
  if (row.note) { const n = document.createElement("div"); n.className = "note-line"; n.textContent = row.note; meta.appendChild(n); }
  for (const t of row.tags || []) { const c = document.createElement("button"); c.className = "tag"; c.dataset.tag = t; c.textContent = "#" + t; meta.appendChild(c); }
  el.classList.toggle("dim", !!query && !matches(row, query));
}
function matches(row, q) {
  q = q.toLowerCase().trim();
  if (!q) return true;
  const hay = [row.note, row.url, row.text, row.status, nameOf(row.created_by), ...(row.tags || []).map((t) => "#" + t + " " + t)].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
function setQuery(q) {
  query = q.startsWith("#") || !q ? q : q;
  const s = $("#search"); if (s && s.value !== q) s.value = q;
  for (const [id, el] of els) renderMeta(el, items.get(id));
  emit("filter", q);
}
function removeLocal(id) {
  els.get(id)?.remove(); els.delete(id); items.delete(id);
  if (selected === id) selected = null;
  $("#empty").hidden = items.size > 0;
  emit("items-changed");
}
function select(id) {
  if (selected && els.get(selected)) els.get(selected).classList.remove("selected");
  selected = id;
  if (id && els.get(id)) els.get(id).classList.add("selected");
}

/* ---------- pan / drag / resize ---------- */
let drag = null;
const pointers = new Map(); // active touches, for pinch-zoom
let pinch = null;
const pinchState = () => {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
};
stage.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { endDrag(); pinch = pinchState(); return; }
  if (pointers.size > 2) return;
  if (e.button !== 0) return;
  const t = e.target;
  const itemEl = t.closest(".item");
  if (!itemEl) {
    select(null);
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    stage.classList.add("panning");
    stage.setPointerCapture(e.pointerId);
    return;
  }
  const id = itemEl.dataset.id;
  select(id);
  if (t.closest(".del") || t.tagName === "TEXTAREA") return;
  if (t.tagName === "VIDEO" && e.offsetY > t.clientHeight - 48) return; // leave the controls alone
  const row = items.get(id);
  const resizing = !!t.closest(".rz");
  row.z = Math.max(0, ...[...items.values()].map((i) => i.z)) + 1;
  itemEl.style.zIndex = row.z;
  drag = {
    mode: resizing ? "resize" : "move", id, moved: false,
    sx: e.clientX, sy: e.clientY, ox: row.x, oy: row.y, ow: row.w, oh: row.h,
    ratio: row.w / row.h, keepRatio: row.type === "image" || row.type === "video",
  };
  itemEl.classList.add("dragging");
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const n = pinchState();
    zoomAt(n.cx, n.cy, n.d / pinch.d);
    view.x += n.cx - pinch.cx; view.y += n.cy - pinch.cy;
    applyView();
    pinch = n;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (drag.mode === "pan") { view.x = drag.ox + dx; view.y = drag.oy + dy; applyView(); return; }
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  const row = items.get(drag.id), el = els.get(drag.id);
  if (drag.mode === "move") {
    row.x = Math.round(drag.ox + dx / view.z); row.y = Math.round(drag.oy + dy / view.z);
    el.style.left = row.x + "px"; el.style.top = row.y + "px";
  } else {
    row.w = Math.max(100, Math.round(drag.ow + dx / view.z));
    row.h = drag.keepRatio ? Math.round(row.w / drag.ratio) : Math.max(60, Math.round(drag.oh + dy / view.z));
    el.style.width = row.w + "px"; el.style.height = row.h + "px";
  }
});
async function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  stage.classList.remove("panning");
  if (d.mode === "pan") return;
  els.get(d.id)?.classList.remove("dragging");
  const row = items.get(d.id);
  if (!row) return;
  const { error } = await sb.from("items").update({ x: row.x, y: row.y, w: row.w, h: row.h, z: row.z }).eq("id", d.id);
  if (error) status(error.message, 4000);
  d.justDragged = d.moved;
  if (d.moved) { suppressClick = true; setTimeout(() => (suppressClick = false), 0); }
}
let suppressClick = false;
const release = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  endDrag();
};
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
stage.addEventListener("click", (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);

window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if ((e.key === "Delete" || e.key === "Backspace") && selected) deleteItem(selected);
  else if (e.key === "0") fit();
  else if (e.key === "+" || e.key === "=") $("#zoom-in").click();
  else if (e.key === "-") $("#zoom-out").click();
});

/* ---------- create / delete ---------- */
async function insertItem(fields) {
  if (!board) return null;
  const z = Math.max(0, ...[...items.values()].map((i) => i.z)) + 1;
  const row = { board_id: board.id, created_by: user.id, author: displayName(), z, ...fields };
  const { data, error } = await sb.from("items").insert(row).select().single();
  if (error) { status(error.message, 5000); return null; }
  if (data.board_id === board.id) upsertLocal(data);
  emit("item-added", data);
  return data;
}
// Soft delete: only the owner can remove an item, and it can be restored from Trash.
async function deleteItem(id) {
  const row = items.get(id);
  if (!row) return;
  if (row.created_by !== user.id) return status(`Only ${nameOf(row.created_by) || "the person who added it"} can delete this`, 3500);
  removeLocal(id);
  const { error } = await sb.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) { upsertLocal(row); return status(error.message, 4000); }
  status("Moved to Trash (Menu → Trash to restore)", 3500);
  emit("item-removed", id);
}

function measure(url, type) {
  return new Promise((resolve) => {
    const done = (w, h) => resolve(w && h ? { w, h } : { w: 360, h: 240 });
    if (type === "image") {
      const i = new Image(); i.onload = () => done(i.naturalWidth, i.naturalHeight); i.onerror = () => done(); i.src = url;
    } else {
      const v = document.createElement("video"); v.preload = "metadata";
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight); v.onerror = () => done(); v.src = url;
    }
  });
}
function fitSize(nw, nh, type) {
  const w = type === "video" ? (nw >= nh ? 420 : 240) : Math.min(360, Math.max(200, nw));
  return { w, h: Math.round(w * nh / nw) };
}

async function addFiles(files, at) {
  if (!board) return;
  at = at || viewCenter();
  let n = 0;
  busy++;
  for (const f of files) {
    const type = f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "image" : null;
    if (!type) { status(`${f.name}: only images and videos`, 3500); continue; }
    if (f.size > MAX_FILE_MB * 1024 * 1024) { status(`${f.name} is over ${MAX_FILE_MB} MB. Paste a YouTube/Drive link instead.`, 5000); continue; }
    status(`Uploading ${f.name}…`);
    const path = `${board.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type });
    if (error) { status(`Upload failed: ${error.message}`, 5000); continue; }
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const m = await measure(url, type);
    const s = fitSize(m.w, m.h, type);
    await insertItem({ type, url, path, x: Math.round(at.x - s.w / 2 + n * 30), y: Math.round(at.y - s.h / 2 + n * 30), ...s });
    n++;
  }
  busy--;
  if (!busy) status(n ? `Added ${n} item${n > 1 ? "s" : ""}` : "", 2000);
}

async function addUrl(text, at, extra = {}) {
  at = at || viewCenter();
  const href = safeUrl(text.trim());
  if (!href) return false;
  let type = "link", url = href, s = { w: 240, h: 90 };
  const yt = youtubeId(href), vm = vimeoId(href), ig = instagramCode(href);
  if (ig) { type = "embed"; url = `https://www.instagram.com/reel/${ig}/embed`; s = { w: 340, h: 640 }; }
  else if (yt) { type = "embed"; url = `https://www.youtube-nocookie.com/embed/${yt}`; s = { w: 420, h: 236 }; }
  else if (vm) { type = "embed"; url = `https://player.vimeo.com/video/${vm}`; s = { w: 420, h: 236 }; }
  else if (IMG_RE.test(href) || VID_RE.test(href)) {
    type = IMG_RE.test(href) ? "image" : "video";
    s = fitSize(...Object.values(await measure(href, type)), type);
  }
  await insertItem({ type, url, x: Math.round(at.x - s.w / 2), y: Math.round(at.y - s.h / 2), ...s, ...extra });
  return true;
}

$("#btn-upload").onclick = () => $("#file-input").click();
$("#file-input").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
$("#btn-note").onclick = async () => {
  const c = viewCenter();
  await insertItem({ type: "note", text: "", x: Math.round(c.x - 100), y: Math.round(c.y - 80), w: 200, h: 160 });
};
$("#btn-link").onclick = async () => {
  if (window.MB.compose) return window.MB.compose("");
  const u = prompt("Paste a link (YouTube, Vimeo, image, or any page)");
  if (u && !(await addUrl(u))) status("That doesn't look like a valid link", 3000);
};

/* ---------- drop & paste ---------- */
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dropping"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dropping"));
stage.addEventListener("drop", async (e) => {
  e.preventDefault(); stage.classList.remove("dropping");
  const at = toWorld(e.clientX, e.clientY);
  if (e.dataTransfer.files.length) return addFiles([...e.dataTransfer.files], at);
  const t = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (t) addUrl(t, at);
});
window.addEventListener("paste", (e) => {
  if (!board || $("#app").hidden) return;
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); return addFiles(files); }
  const t = e.clipboardData?.getData("text");
  if (t && safeUrl(t.trim())) { e.preventDefault(); addUrl(t); }
});

$("#search").addEventListener("input", (e) => setQuery(e.target.value));

// Shared surface for the feature files loaded after this one (social.js, ...).
window.MB = {
  get sb() { return sb; }, get user() { return user; }, get board() { return board; },
  items, els, profiles, bus, emit, status, $, safeUrl, nameOf, avatarEl, displayName,
  showCanvas() { if (needFit && stage.clientWidth) { needFit = false; fit(); } },
  allBoards, createBoard, fit, applyView, getView: () => view,
  renderMeta, upsertLocal, removeLocal, addUrl, insertItem, deleteItem, openBoard, loadBoards, loadProfiles, setQuery, matches,
  get query() { return query; }, BUCKET, MAX_FILE_MB,
  compose: null, // set by social.js
};

init();
})();

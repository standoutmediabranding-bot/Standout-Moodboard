// Boards manager (create / rename / archive / delete) and the "Tidy up" button.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const sbc = () => MB.sb;

/* ---------- boards manager ---------- */
const monthName = () => new Date().toLocaleString("en", { month: "long", year: "numeric" });

async function manager() {
  const { data: rows } = await sbc().from("items").select("board_id").is("deleted_at", null);
  const counts = {};
  (rows || []).forEach((r) => (counts[r.board_id] = (counts[r.board_id] || 0) + 1));
  paint(counts);
}

function paint(counts) {
  const name = h("input", { placeholder: "New board name, e.g. Esoft project", maxLength: 60 });
  const create = async (n) => {
    n = (n || "").trim();
    if (!n) return;
    const b = await MB.createBoard(n);
    if (b) { MB.modal.close(); await MB.loadBoards(b.id); MB.status(`Board “${n}” created`, 2500); }
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") create(name.value); });
  const ideas = [monthName(), "Client project", "Inspiration", "Thumbnails"];
  const head = h("div", { class: "form" },
    h("div", { class: "row" }, name, h("button", { class: "primary", on: { click: () => create(name.value) } }, "Create")),
    h("div", { class: "chips" }, ideas.map((t) => h("button", { type: "button", class: "chip", on: { click: () => { name.value = t; name.focus(); } } }, t))));

  const rowFor = (b) => {
    const mine = b.created_by === MB.user.id;
    const title = h("span", { class: "grow b-name" }, b.name, b.id === MB.board?.id ? h("span", { class: "chip status" }, "open") : null);
    const row = h("div", { class: "person" + (b.archived ? " archived" : "") }, title,
      h("span", { class: "muted small" }, `${counts[b.id] || 0} refs`),
      h("button", { on: { click: () => { MB.modal.close(); if (b.archived) return; $("#board-select").value = b.id; MB.openBoard(b.id); } } }, b.archived ? "Archived" : "Open"),
      h("button", { title: "Rename", on: { click: () => rename(b, title) } }, "✎"),
      h("button", { title: b.archived ? "Bring back" : "Archive", on: { click: () => setArchived(b, !b.archived) } }, b.archived ? "Restore" : "Archive"),
      mine && h("button", { class: "danger", title: "Delete board", on: { click: () => remove(b, counts[b.id] || 0) } }, "Delete"));
    row.querySelector("button").disabled = b.archived;
    return row;
  };
  const active = MB.allBoards.filter((b) => !b.archived), archived = MB.allBoards.filter((b) => b.archived);
  MB.modal.open("Boards", head,
    h("div", { class: "people" }, active.map(rowFor)),
    archived.length ? h("h4", {}, "Archived") : null,
    archived.length ? h("div", { class: "people" }, archived.map(rowFor)) : null,
    h("p", { class: "muted small" }, "Archive hides a board without deleting anything. Only the person who made a board can delete it."));
  setTimeout(() => name.focus(), 50);
}

function rename(b, titleEl) {
  const input = h("input", { value: b.name, maxLength: 60 });
  const done = async () => {
    const n = input.value.trim();
    if (n && n !== b.name) {
      const { error } = await sbc().from("boards").update({ name: n }).eq("id", b.id);
      if (error) return MB.status(error.message, 4000);
    }
    await MB.loadBoards(undefined, true); manager();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); if (e.key === "Escape") manager(); });
  input.addEventListener("blur", done);
  titleEl.replaceChildren(input); input.focus(); input.select();
}
async function setArchived(b, archived) {
  const { error } = await sbc().from("boards").update({ archived }).eq("id", b.id);
  if (error) return MB.status(error.message, 4000);
  await MB.loadBoards(undefined, true);
  manager();
}
async function remove(b, n) {
  if (!confirm(`Delete “${b.name}” and its ${n} item${n === 1 ? "" : "s"} for everyone? This cannot be undone. (Archive keeps everything.)`)) return;
  const { data: files } = await sbc().from("items").select("path").eq("board_id", b.id).not("path", "is", null);
  const { error } = await sbc().from("boards").delete().eq("id", b.id);
  if (error) return MB.status(error.message, 4000);
  const paths = (files || []).map((f) => f.path);
  if (paths.length) sbc().storage.from(MB.BUCKET).remove(paths);
  await MB.loadBoards(undefined, true);
  manager();
}
$("#new-board").textContent = "Boards";
$("#new-board").onclick = manager;
MB.menuItems.unshift({ icon: "🗂", label: "Boards (new, rename, archive)", run: manager });

// teammates adding / renaming boards show up without a reload
let t;
MB.bus.addEventListener("login", () => {
  sbc().channel("boards-live").on("postgres_changes", { event: "*", schema: "public", table: "boards" }, () => {
    clearTimeout(t); t = setTimeout(() => MB.loadBoards(undefined, true), 400);
  }).subscribe();
});

/* ---------- Tidy up: sort the canvas into columns by type ---------- */
const GROUPS = [
  (r) => r.type === "video" || r.type === "embed",
  (r) => r.type === "image",
  (r) => r.type === "link",
  (r) => r.type === "note",
];
function layout(rows) {
  const out = [];
  let x0 = 0;
  for (const test of GROUPS) {
    const g = rows.filter(test).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!g.length) continue;
    const sized = g.map((r) => {
      if (r.type === "image" || r.type === "video") return { r, w: 280, h: Math.round(280 / (r.w / r.h)) };
      return { r, w: r.w, h: r.h };
    });
    const colW = Math.max(...sized.map((s) => s.w)) + 28;
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(g.length / 2))));
    const ys = Array(cols).fill(0);
    for (const s of sized) {
      const c = ys.indexOf(Math.min(...ys));
      out.push({ id: s.r.id, x: x0 + c * colW, y: ys[c], w: s.w, h: s.h });
      ys[c] += s.h + (s.r.type === "note" ? 30 : 76); // room for the note + tags shown under each card
    }
    x0 += cols * colW + 110;
  }
  return out;
}
async function apply(plan) {
  for (const p of plan) {
    const r = MB.items.get(p.id); if (!r) continue;
    Object.assign(r, { x: p.x, y: p.y, w: p.w, h: p.h });
    MB.upsertLocal(r);
  }
  const results = await Promise.all(plan.map((p) => sbc().from("items").update({ x: p.x, y: p.y, w: p.w, h: p.h }).eq("id", p.id)));
  const bad = results.find((r) => r.error);
  if (bad) MB.status(bad.error.message, 4000);
}
const undoBar = h("div", { class: "undo", hidden: true });
document.body.appendChild(undoBar);
let undoTimer;
function showUndo(before) {
  clearTimeout(undoTimer);
  undoBar.replaceChildren("Board tidied. ", h("button", { class: "link", on: { click: async () => {
    undoBar.hidden = true; await apply(before); MB.fit();
  } } }, "Undo"));
  undoBar.hidden = false;
  undoTimer = setTimeout(() => (undoBar.hidden = true), 15000);
}
async function tidy() {
  const rows = [...MB.items.values()];
  if (rows.length < 2) return MB.status("Add a few cards first", 2500);
  if (!confirm("Tidy up will line up every card on this board in columns by type (videos, designs, links, notes). Everyone on the team will see the new layout. You'll get a few seconds to undo. Continue?")) return;
  const before = rows.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
  await apply(layout(rows));
  MB.fit();
  showUndo(before);
}
const tidyBtn = h("button", { id: "btn-tidy", class: "canvas-only desk", title: "Sort cards into columns by type", on: { click: tidy } }, "Tidy up");
$("#btn-note").after(tidyBtn);
})();

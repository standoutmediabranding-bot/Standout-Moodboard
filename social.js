// Menu, members, profile and trash. Loaded after app.js, uses window.MB.
(() => {
const MB = window.MB;
const $ = MB.$;
const sbc = () => MB.sb;

/* ---------- tiny DOM builder + modal ---------- */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}
const modal = $("#modal"), body = $("#modal-body");
function openModal(title, ...nodes) {
  $("#modal-title").textContent = title;
  body.replaceChildren(...nodes);
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; body.replaceChildren(); }
$("#modal-close").onclick = closeModal;
modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeModal(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
MB.h = h;
MB.modal = { open: openModal, close: closeModal };

const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
};
MB.ago = ago;

/* ---------- menu ---------- */
MB.menuItems = [
  { icon: "👤", label: "My profile", run: () => profileModal() },
  { icon: "👥", label: "Members", run: () => membersModal() },
  { icon: "🗑", label: "Trash (restore my deleted items)", run: () => trashModal() },
];
function menuModal() {
  const list = h("div", { class: "menu-list" },
    MB.menuItems.map((m) => h("button", { class: "menu-row", on: { click: () => m.run() } }, h("span", {}, m.icon), m.label)),
    h("button", { class: "menu-row", on: { click: () => $("#sign-out").click() } }, h("span", {}, "↩"), "Sign out"));
  openModal("Menu", list);
}
$("#btn-menu").onclick = menuModal;

/* ---------- who is online ---------- */
MB.online = new Set();
let presence = null;
function startPresence() {
  if (presence || !MB.user) return;
  presence = sbc().channel("team-presence", { config: { presence: { key: MB.user.id } } });
  presence.on("presence", { event: "sync" }, () => {
    MB.online = new Set(Object.keys(presence.presenceState()));
    MB.emit("presence");
  }).subscribe((s) => { if (s === "SUBSCRIBED") presence.track({ at: Date.now() }); });
}
MB.bus.addEventListener("login", () => {
  startPresence();
  sbc().channel("profiles-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
      if (p.new && p.new.id) { MB.profiles.set(p.new.id, p.new); MB.emit("profiles"); }
    }).subscribe();
});
MB.bus.addEventListener("profiles", () => {
  for (const [id, el] of MB.els) MB.renderMeta?.(el, MB.items.get(id));
});

/* ---------- members ---------- */
async function membersModal() {
  const { data: rows } = await sbc().from("items").select("created_by").is("deleted_at", null);
  const counts = {};
  (rows || []).forEach((r) => (counts[r.created_by] = (counts[r.created_by] || 0) + 1));
  const people = [...MB.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  const list = h("div", { class: "people" }, people.map((p) =>
    h("div", { class: "person" },
      h("span", { class: "av-wrap" }, MB.avatarEl(p.id, 38), MB.online.has(p.id) && h("i", { class: "dot", title: "Online now" })),
      h("div", { class: "grow" }, h("strong", {}, p.name, p.id === MB.user.id ? " (you)" : ""),
        h("div", { class: "muted small" }, MB.online.has(p.id) ? "Online now" : "Offline")),
      h("span", { class: "muted small" }, `${counts[p.id] || 0} refs`))));
  openModal(`Members (${people.length})`, list,
    h("p", { class: "muted small" }, "To add or remove someone, use Supabase → Authentication → Users."));
}

/* ---------- profile ---------- */
const COLORS = ["#1fd35e", "#3b82f6", "#a855f7", "#f97316", "#ef4444", "#14b8a6", "#eab308", "#ec4899"];
function profileModal() {
  const me = MB.profiles.get(MB.user.id) || { name: "", color: COLORS[0] };
  let color = me.color, avatar = me.avatar_url || null;
  const name = h("input", { value: me.name, maxLength: 30, placeholder: "Your name" });
  const preview = h("span", { class: "av-preview" }, MB.avatarEl(MB.user.id, 64));
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const swatches = h("div", { class: "swatches" }, COLORS.map((c) =>
    h("button", { type: "button", class: "swatch" + (c === color ? " on" : ""), style: `background:${c}`, on: { click: (e) => {
      color = c; swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("on")); e.currentTarget.classList.add("on");
    } } })));
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return MB.status("Pick a photo under 5 MB", 3000);
    MB.status("Uploading photo…");
    const path = `avatars/${MB.user.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await sbc().storage.from(MB.BUCKET).upload(path, f, { contentType: f.type });
    if (error) return MB.status(error.message, 4000);
    avatar = sbc().storage.from(MB.BUCKET).getPublicUrl(path).data.publicUrl;
    const tmp = { ...me, avatar_url: avatar, color, name: name.value };
    MB.profiles.set(MB.user.id, tmp); preview.replaceChildren(MB.avatarEl(MB.user.id, 64)); MB.status("", 0);
  };
  const save = h("button", { class: "primary", on: { click: async () => {
    const row = { id: MB.user.id, name: name.value.trim() || me.name || "Member", color, avatar_url: avatar };
    const { error } = await sbc().from("profiles").upsert(row);
    if (error) return MB.status(error.message, 4000);
    MB.profiles.set(row.id, row); MB.emit("profiles"); closeModal(); MB.status("Profile saved", 2000);
  } } }, "Save");
  openModal("My profile",
    h("div", { class: "form" },
      h("div", { class: "row" }, preview, h("button", { on: { click: () => file.click() } }, "Change photo"), file),
      h("label", {}, "Name", name),
      h("label", {}, "Colour", swatches),
      save));
}

/* ---------- trash ---------- */
async function trashModal() {
  const { data, error } = await sbc().from("items").select("*").eq("created_by", MB.user.id)
    .not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) return MB.status(error.message, 4000);
  const label = (r) => r.note || r.text || r.url?.replace(/^https?:\/\//, "").slice(0, 50) || r.type;
  const list = h("div", { class: "trash" }, data.length ? data.map((r) => {
    const row = h("div", { class: "person" },
      h("span", { class: "type-pill" }, r.type),
      h("div", { class: "grow" }, h("div", {}, label(r)), h("div", { class: "muted small" }, "Deleted " + ago(r.deleted_at))),
      h("button", { on: { click: async () => {
        const { error: e } = await sbc().from("items").update({ deleted_at: null }).eq("id", r.id);
        if (e) return MB.status(e.message, 4000);
        row.remove(); MB.status("Restored", 2000); if (MB.board) MB.openBoard(MB.board.id);
      } } }, "Restore"),
      h("button", { class: "danger", on: { click: async () => {
        if (!confirm("Delete forever? This also removes the uploaded file.")) return;
        const { error: e } = await sbc().from("items").delete().eq("id", r.id);
        if (e) return MB.status(e.message, 4000);
        if (r.path) sbc().storage.from(MB.BUCKET).remove([r.path]);
        row.remove();
      } } }, "Delete forever"));
    return row;
  }) : h("p", { class: "muted" }, "Trash is empty."));
  openModal("Trash", list);
}
})();

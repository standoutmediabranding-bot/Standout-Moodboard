// Reactions, comments, favourites and the "what's new" list. Loaded after social.js.
(() => {
const MB = window.MB;
const $ = MB.$;
const sbc = () => MB.sb;
const EMOJIS = ["🔥", "😍", "💡", "👍"];

const D = (MB.data = {
  EMOJIS,
  reacts: new Map(),    // item id -> [{item_id,user_id,emoji}]
  comments: new Map(),  // item id -> [comment rows, oldest first]
  favs: new Set(),      // item ids I saved
  notifs: { items: [], comments: [] },
});
const changed = (id) => MB.emit("social-changed", id);

function pushUnique(list, row, same) {
  if (!list.some(same)) list.push(row);
}

async function load(ids) {
  if (!ids.length) return;
  const [r, c] = await Promise.all([
    sbc().from("reactions").select("*").in("item_id", ids),
    sbc().from("comments").select("*").in("item_id", ids).order("created_at"),
  ]);
  for (const id of ids) { D.reacts.set(id, []); D.comments.set(id, []); }
  (r.data || []).forEach((x) => D.reacts.get(x.item_id)?.push(x));
  (c.data || []).forEach((x) => D.comments.get(x.item_id)?.push(x));
  ids.forEach(changed);
}
D.load = load;

// Whole-board load. Filtering by board on the server keeps the request small however many cards a board has
// (listing hundreds of ids in the URL would eventually exceed the URL length limit and fail).
async function loadBoard(boardId) {
  const ids = [...MB.items.keys()];
  if (!ids.length) return;
  const [r, c] = await Promise.all([
    sbc().from("reactions").select("*, items!inner(board_id)").eq("items.board_id", boardId),
    sbc().from("comments").select("*, items!inner(board_id)").eq("items.board_id", boardId).order("created_at"),
  ]);
  if (r.error || c.error) { // fallback: same thing in small batches
    for (let i = 0; i < ids.length; i += 80) await load(ids.slice(i, i + 80));
    return;
  }
  for (const id of ids) { D.reacts.set(id, []); D.comments.set(id, []); }
  (r.data || []).forEach((x) => D.reacts.get(x.item_id)?.push(x));
  (c.data || []).forEach((x) => D.comments.get(x.item_id)?.push(x));
  ids.forEach(changed);
}

D.reactionCounts = (id) => {
  const out = {};
  for (const r of D.reacts.get(id) || []) out[r.emoji] = (out[r.emoji] || 0) + 1;
  return out;
};
D.mine = (id, emoji) => (D.reacts.get(id) || []).some((r) => r.user_id === MB.user.id && r.emoji === emoji);

D.toggleReact = async (id, emoji) => {
  const list = D.reacts.get(id) || (D.reacts.set(id, []), D.reacts.get(id));
  const had = D.mine(id, emoji);
  if (had) D.reacts.set(id, list.filter((r) => !(r.user_id === MB.user.id && r.emoji === emoji)));
  else list.push({ item_id: id, user_id: MB.user.id, emoji });
  changed(id);
  const q = had
    ? sbc().from("reactions").delete().eq("item_id", id).eq("user_id", MB.user.id).eq("emoji", emoji)
    : sbc().from("reactions").insert({ item_id: id, user_id: MB.user.id, emoji });
  const { error } = await q;
  if (error) { MB.status(error.message, 3500); await load([id]); }
};

D.addComment = async (id, body, parentId) => {
  body = body.trim();
  if (!body) return null;
  const { data, error } = await sbc().from("comments").insert({ item_id: id, body, parent_id: parentId || null }).select().single();
  if (error) { MB.status(error.message, 4000); return null; }
  const list = D.comments.get(id) || (D.comments.set(id, []), D.comments.get(id));
  pushUnique(list, data, (x) => x.id === data.id);
  changed(id);
  return data;
};
D.delComment = async (c) => {
  const { error } = await sbc().from("comments").delete().eq("id", c.id);
  if (error) return MB.status(error.message, 3500);
  D.comments.set(c.item_id, (D.comments.get(c.item_id) || []).filter((x) => x.id !== c.id && x.parent_id !== c.id));
  changed(c.item_id);
};

D.toggleFav = async (id) => {
  const had = D.favs.has(id);
  had ? D.favs.delete(id) : D.favs.add(id);
  changed(id);
  const q = had
    ? sbc().from("favourites").delete().eq("item_id", id).eq("user_id", MB.user.id)
    : sbc().from("favourites").insert({ item_id: id, user_id: MB.user.id });
  const { error } = await q;
  if (error) { had ? D.favs.add(id) : D.favs.delete(id); changed(id); MB.status(error.message, 3500); }
};

/* ---------- small "💬 3 · 🔥 2" pill on each canvas card ---------- */
function paintCounts(id) {
  const el = MB.els.get(id);
  if (!el) return;
  let pill = el.querySelector(".counts");
  const cc = (D.comments.get(id) || []).length;
  const rc = Object.values(D.reactionCounts(id)).reduce((a, b) => a + b, 0);
  const fav = D.favs.has(id);
  if (!cc && !rc && !fav) { pill?.remove(); return; }
  if (!pill) {
    pill = document.createElement("button");
    pill.className = "counts";
    pill.onclick = (e) => { e.stopPropagation(); MB.emit("open-item", id); };
    el.appendChild(pill);
  }
  pill.textContent = [fav ? "★" : "", cc ? `💬 ${cc}` : "", rc ? `🔥 ${rc}` : ""].filter(Boolean).join("  ");
}
MB.bus.addEventListener("social-changed", (e) => paintCounts(e.detail));
MB.bus.addEventListener("board-opened", (e) => loadBoard(e.detail));

/* ---------- live updates from teammates ---------- */
MB.bus.addEventListener("login", async () => {
  const { data } = await sbc().from("favourites").select("item_id");
  D.favs = new Set((data || []).map((x) => x.item_id));
  sbc().channel("social-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, (p) => {
      const row = p.new?.item_id ? p.new : p.old; if (!row?.item_id || !MB.items.has(row.item_id)) return;
      const list = D.reacts.get(row.item_id) || (D.reacts.set(row.item_id, []), D.reacts.get(row.item_id));
      const same = (x) => x.user_id === row.user_id && x.emoji === row.emoji;
      if (p.eventType === "DELETE") D.reacts.set(row.item_id, list.filter((x) => !same(x)));
      else pushUnique(list, row, same);
      changed(row.item_id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, (p) => {
      const row = p.new?.item_id ? p.new : p.old; if (!row?.item_id) return;
      const list = D.comments.get(row.item_id) || (D.comments.set(row.item_id, []), D.comments.get(row.item_id));
      if (p.eventType === "DELETE") D.comments.set(row.item_id, list.filter((x) => x.id !== row.id));
      else pushUnique(list, row, (x) => x.id === row.id);
      changed(row.item_id);
      if (p.eventType === "INSERT" && row.user_id !== MB.user.id) loadNotifs();
    }).subscribe();
  loadNotifs();
});

/* ---------- what's new since I last looked ---------- */
const seenKey = () => "mb:seen:" + MB.user.id;
async function loadNotifs() {
  const since = localStorage.getItem(seenKey()) || new Date(Date.now() - 7 * 864e5).toISOString();
  const me = MB.user.id, myTag = "@" + (MB.nameOf(me) || "").replace(/\s+/g, "").toLowerCase();
  const [it, cm] = await Promise.all([
    sbc().from("items").select("*").gt("created_at", since).neq("created_by", me).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    sbc().from("comments").select("*").gt("created_at", since).neq("user_id", me).order("created_at", { ascending: false }).limit(100),
  ]);
  const comments = cm.data || [];
  let relevant = [];
  if (comments.length) {
    const ids = [...new Set(comments.map((c) => c.item_id))];
    const [own, mine] = await Promise.all([
      sbc().from("items").select("id,created_by").in("id", ids),
      sbc().from("comments").select("item_id").eq("user_id", me).in("item_id", ids),
    ]);
    const owner = Object.fromEntries((own.data || []).map((x) => [x.id, x.created_by]));
    const joined = new Set((mine.data || []).map((x) => x.item_id));
    relevant = comments.filter((c) => owner[c.item_id] === me || joined.has(c.item_id) || (MB.nameOf(me) && c.body.toLowerCase().includes(myTag)));
  }
  D.notifs = { items: it.data || [], comments: relevant };
  MB.emit("notifs");
}
D.markSeen = () => { localStorage.setItem(seenKey(), new Date().toISOString()); D.notifs = { items: [], comments: [] }; MB.emit("notifs"); };
D.notifCount = () => D.notifs.items.length + D.notifs.comments.length;
})();

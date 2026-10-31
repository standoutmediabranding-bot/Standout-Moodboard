// Dashboard, Saved list and the WhatsApp "share today's refs" summary.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const D = MB.data;
const sbc = () => MB.sb;
const DAY = 864e5;
const KIND = { video: "a video", embed: "a reel/video", image: "a design", link: "a link", note: "a note" };

/* ---------- dashboard ---------- */
async function dashboard(range = "7") {
  const [items, reacts, comments] = await Promise.all([
    MB.fetchAll(() => sbc().from("items").select("id,created_by,created_at,type,tags,note,board_id").is("deleted_at", null).order("created_at")),
    MB.fetchAll(() => sbc().from("reactions").select("item_id,user_id,created_at").order("created_at")),
    MB.fetchAll(() => sbc().from("comments").select("item_id,user_id,created_at").order("created_at")),
  ]);
  const from = range === "all" ? 0 : Date.now() - Number(range) * DAY;
  const inR = (x) => new Date(x.created_at).getTime() >= from;
  const rItems = items.filter(inR), rReacts = reacts.filter(inR), rComments = comments.filter(inR);
  const owner = Object.fromEntries(items.map((i) => [i.id, i.created_by]));

  const people = [...MB.profiles.values()].map((p) => {
    const mineItems = rItems.filter((i) => i.created_by === p.id);
    const times = [...items, ...reacts, ...comments].filter((x) => (x.created_by || x.user_id) === p.id).map((x) => new Date(x.created_at).getTime());
    return {
      p, shared: mineItems.length,
      comments: rComments.filter((c) => c.user_id === p.id).length,
      given: rReacts.filter((r) => r.user_id === p.id).length,
      received: rReacts.filter((r) => owner[r.item_id] === p.id && r.user_id !== p.id).length,
      last: times.length ? Math.max(...times) : 0,
    };
  }).sort((a, b) => b.shared - a.shared || b.comments - a.comments);
  const maxShared = Math.max(1, ...people.map((x) => x.shared));

  const tile = (n, l) => h("div", { class: "tile" }, h("b", {}, String(n)), h("span", { class: "muted small" }, l));
  const active = people.filter((x) => x.shared || x.comments || x.given).length;

  // refs saved per day, last 14 days
  const days = Array.from({ length: 14 }, (_, k) => {
    const d = new Date(Date.now() - (13 - k) * DAY); d.setHours(0, 0, 0, 0);
    const n = items.filter((i) => { const t = new Date(i.created_at); return t >= d && t < new Date(+d + DAY); }).length;
    return { d, n };
  });
  const maxDay = Math.max(1, ...days.map((x) => x.n));

  // best refs: most reactions + replies
  const score = {};
  rReacts.forEach((r) => (score[r.item_id] = (score[r.item_id] || 0) + 1));
  rComments.forEach((c) => (score[c.item_id] = (score[c.item_id] || 0) + 2));
  const top = items.filter((i) => score[i.id]).sort((a, b) => score[b.id] - score[a.id]).slice(0, 5);

  const tagCount = {};
  rItems.forEach((i) => (i.tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const rangeBtn = (v, l) => h("button", { class: "chip" + (range === v ? " on" : ""), on: { click: () => dashboard(v) } }, l);
  MB.modal.open("Team dashboard",
    h("div", { class: "chips" }, rangeBtn("7", "Last 7 days"), rangeBtn("30", "Last 30 days"), rangeBtn("all", "All time")),
    h("div", { class: "tiles" }, tile(rItems.length, "refs saved"), tile(rComments.length, "comments"), tile(rReacts.length, "reactions"), tile(`${active}/${people.length}`, "members active")),
    h("h4", {}, "Who is sharing"),
    h("div", { class: "people" }, people.map((x) => h("div", { class: "dash-row" },
      MB.avatarEl(x.p.id, 30),
      h("div", { class: "grow" },
        h("div", {}, h("strong", {}, x.p.name), h("span", { class: "muted small" }, `  ${x.comments} comments · ${x.given} reactions given · ${x.received} received`)),
        h("div", { class: "bar" }, h("i", { style: `width:${(x.shared / maxShared) * 100}%` }))),
      h("b", {}, String(x.shared))))),
    h("h4", {}, "Refs saved, last 14 days"),
    h("div", { class: "spark" }, days.map((x) => h("i", { title: `${x.d.toDateString()}: ${x.n}`, style: `height:${Math.max(4, (x.n / maxDay) * 100)}%` }))),
    topTags.length ? h("h4", {}, "Popular tags") : null,
    topTags.length ? h("div", { class: "chips" }, topTags.map(([t, n]) => h("button", { class: "tag", on: { click: () => { MB.modal.close(); MB.setQuery("#" + t); } } }, `#${t} ${n}`))) : null,
    top.length ? h("h4", {}, "Most loved refs") : null,
    top.length ? h("div", { class: "people" }, top.map((i) => h("button", { class: "person news", on: { click: () => { MB.modal.close(); MB.viewer.open(i.id); } } },
      MB.avatarEl(i.created_by, 28), h("div", { class: "grow" }, (i.note || KIND[i.type] || "item").slice(0, 70), h("div", { class: "muted small" }, MB.nameOf(i.created_by))),
      h("span", { class: "muted small" }, `${score[i.id]} pts`)))) : null,
    h("p", { class: "muted small" }, "Counts what people save and say. Time spent on the site isn't tracked."));
}

/* ---------- saved list ---------- */
async function saved() {
  const { data: f } = await sbc().from("favourites").select("item_id,created_at").order("created_at", { ascending: false });
  const ids = (f || []).map((x) => x.item_id);
  let rows = [];
  if (ids.length) {
    const { data } = await sbc().from("items").select("*").in("id", ids).is("deleted_at", null);
    const order = Object.fromEntries(ids.map((id, i) => [id, i]));
    rows = (data || []).sort((a, b) => order[a.id] - order[b.id]);
  }
  const list = h("div", { class: "people" }, rows.length ? rows.map((r) => h("div", { class: "person" },
    h("span", { class: "type-pill" }, r.type),
    h("button", { class: "grow linkish", on: { click: () => { MB.modal.close(); MB.viewer.open(r.id); } } }, (r.note || r.text || (r.url || "").replace(/^https?:\/\//, "")).slice(0, 80) || KIND[r.type],
      h("div", { class: "muted small" }, `${MB.nameOf(r.created_by)} · ${[...$("#board-select").options].find((o) => o.value === r.board_id)?.textContent || ""}`)),
    h("button", { title: "Remove from saved", on: { click: async (e) => { await D.toggleFav(r.id); e.currentTarget.closest(".person").remove(); } } }, "★"))) : h("p", { class: "muted" }, "Nothing saved yet. Tap ☆ on any card to keep it here."));
  MB.modal.open("My saved list", list);
}

/* ---------- WhatsApp summary ---------- */
async function whatsapp(days = 1) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const { data } = await sbc().from("items").select("*").gt("created_at", since).neq("type", "note").is("deleted_at", null).order("created_at", { ascending: false }).limit(12);
  const rows = data || [];
  const link = location.origin + location.pathname;
  const lines = rows.map((r, i) => `${i + 1}. ${MB.nameOf(r.created_by) || "Someone"} saved ${KIND[r.type] || "something"}${r.note ? `: "${r.note.slice(0, 90)}"` : ""}${r.tags?.length ? " " + r.tags.map((t) => "#" + t).join(" ") : ""}\n   ${MB.origUrl(r) || r.url}`);
  const text = rows.length ? `📌 New on Standout Moodboard (${days === 1 ? "last 24 hours" : "this week"})\n\n${lines.join("\n\n")}\n\nOpen the board: ${link}` : "";
  const box = h("textarea", { rows: 10, value: text, placeholder: "Nothing new in this period." });
  const pick = (d, l) => h("button", { class: "chip" + (days === d ? " on" : ""), on: { click: () => whatsapp(d) } }, l);
  MB.modal.open("Share to WhatsApp group",
    h("div", { class: "chips" }, pick(1, "Today"), pick(7, "This week")),
    h("div", { class: "form" }, box,
      h("div", { class: "row" },
        h("button", { class: "primary", disabled: !rows.length, on: { click: () => window.open("https://wa.me/?text=" + encodeURIComponent(box.value), "_blank", "noopener") } }, "Open WhatsApp"),
        h("button", { disabled: !rows.length, on: { click: async () => { try { await navigator.clipboard.writeText(box.value); MB.status("Copied", 1500); } catch { box.select(); } } } }, "Copy text")),
      h("p", { class: "muted small" }, "WhatsApp opens with this message ready. Pick your team group and press send. You can edit the text first.")));
}

MB.menuItems.splice(1, 0,
  { icon: "📊", label: "Team dashboard", run: () => dashboard() },
  { icon: "★", label: "My saved list", run: saved },
  { icon: "💬", label: "Share new refs to WhatsApp", run: () => whatsapp(1) });
})();

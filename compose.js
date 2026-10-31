// "Save to Moodboard" sheet: opens from the Android share sheet and the Link button.
(() => {
const MB = window.MB;
const { h, $ } = MB;
const STATUSES = [["", "No status"], ["to-try", "To try"], ["using", "Using now"], ["used", "Used in a project"]];

const refKey = (u) => {
  const ig = u.match(/(?:reels?|p|tv)\/([\w-]+)/i);
  if (/instagram\.com/i.test(u) && ig) return ig[1];
  const yt = u.match(/youtu\.be\/([\w-]{6,})|[?&]v=([\w-]{6,})|shorts\/([\w-]{6,})/i);
  if (yt) return yt[1] || yt[2] || yt[3];
  return u;
};
const parseTags = (s) => [...new Set(s.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 8);

function knownTags() {
  const c = {};
  for (const r of MB.items.values()) for (const t of r.tags || []) c[t] = (c[t] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
}

function compose(initial) {
  const urlIn = h("input", { type: "url", placeholder: "Paste a link (Instagram, YouTube, Vimeo, any page)", value: initial || "", inputMode: "url" });
  const boardSel = h("select", {});
  for (const o of $("#board-select").options) boardSel.appendChild(h("option", { value: o.value, textContent: o.textContent }));
  // sharing from a phone: default to the board you saved to last time
  const lastTarget = localStorage.getItem("mb:composeBoard");
  boardSel.value = [...boardSel.options].some((o) => o.value === lastTarget) && initial ? lastTarget : (MB.board?.id || boardSel.value);
  const note = h("textarea", { rows: 3, maxLength: 500, placeholder: "Why are you saving this? e.g. “text animation at 0:05 is clean”" });
  const tagIn = h("input", { placeholder: "Tags: hook, transitions, text-animation" });
  const statusSel = h("select", {}, STATUSES.map(([v, l]) => h("option", { value: v, textContent: l })));
  const warn = h("p", { class: "warn", hidden: true });
  const chips = h("div", { class: "chips" }, knownTags().map((t) => h("button", { type: "button", class: "chip", on: { click: () => {
    const cur = parseTags(tagIn.value); if (!cur.includes(t)) tagIn.value = [...cur, t].join(", ");
  } } }, "#" + t)));

  let checkTimer;
  const checkDup = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const u = urlIn.value.trim();
      if (!MB.safeUrl(u)) { warn.hidden = true; return; }
      const { data } = await MB.sb.from("items").select("created_by,created_at").ilike("url", `%${refKey(u)}%`).is("deleted_at", null).limit(1);
      if (data?.length) { warn.hidden = false; warn.textContent = `Heads up: already shared by ${MB.nameOf(data[0].created_by) || "someone"}, ${MB.ago(data[0].created_at)}. You can still save it.`; }
      else warn.hidden = true;
    }, 350);
  };
  urlIn.addEventListener("input", checkDup);
  checkDup();

  const save = h("button", { class: "primary big", on: { click: async () => {
    const u = urlIn.value.trim();
    if (!MB.safeUrl(u)) return MB.status("That doesn't look like a valid link", 3000);
    save.disabled = true; save.textContent = "Saving…";
    const target = boardSel.value;
    localStorage.setItem("mb:composeBoard", target);
    const same = MB.board && target === MB.board.id;
    const at = same ? undefined : { x: Math.round(Math.random() * 500), y: Math.round(Math.random() * 400) };
    const ok = await MB.addUrl(u, at, { board_id: target, note: note.value.trim() || null, tags: parseTags(tagIn.value), status: statusSel.value || null });
    MB.modal.close();
    if (ok) MB.status("Saved to " + boardSel.selectedOptions[0].textContent, 3500);
    if (ok && !same) { boardSel.value = target; }
  } } }, "Save to board");

  MB.modal.open("Save to Moodboard", h("div", { class: "form" },
    h("label", {}, "Link", urlIn), warn,
    h("label", {}, "Board", boardSel),
    h("label", {}, "Note", note),
    h("label", {}, "Tags", tagIn), chips,
    h("label", {}, "Status", statusSel),
    save));
  setTimeout(() => (initial ? note : urlIn).focus(), 50);
}
MB.compose = compose;
})();

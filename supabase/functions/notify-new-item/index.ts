// Sends a phone notification ("sabari shared a new reel") to every teammate who turned notifications on.
// The database calls this each time a card is saved (see setup3.sql).
//
// Secrets this function needs (Supabase -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (made by scripts/make-vapid-keys.js)
//   VAPID_SUBJECT                         (optional, e.g. https://standout-moodboard.vercel.app)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "https://standout-moodboard.vercel.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const what = (i: { type: string; url?: string }) =>
  i.type === "video" ? "a new video"
  : i.type === "image" ? "a new design"
  : i.type === "link" ? "a new link"
  : /instagram/.test(i.url ?? "") ? "a new reel" : "a new video";

const done = () => new Response("ok");

Deno.serve(async (req) => {
  try {
    const { item_id } = await req.json();
    if (!item_id) return done();

    // Claim the card: only the first call for a brand-new card goes through. That also means a forged call about an old
    // card (anyone can send one with the public key) does nothing.
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: claimed } = await db.from("items")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", item_id).is("notified_at", null).gt("created_at", since).neq("type", "note").is("deleted_at", null)
      .select("*");
    const item = claimed?.[0];
    if (!item) return done();

    const [{ data: who }, { data: board }, { data: subs }] = await Promise.all([
      db.from("profiles").select("name").eq("id", item.created_by).maybeSingle(),
      db.from("boards").select("name").eq("id", item.board_id).maybeSingle(),
      db.from("push_subscriptions").select("*").neq("user_id", item.created_by), // everyone except the person who shared it
    ]);

    const name = who?.name ?? "A teammate";
    const detail = [item.note ? `“${String(item.note).slice(0, 90)}”` : "", board?.name ? `in ${board.name}` : ""].filter(Boolean).join(" ");
    const payload = JSON.stringify({
      title: `${name} shared ${what(item)}`,
      body: detail || "Tap to open it.",
      id: item.id,
      tag: "new-" + item.created_by, // several shares from one person replace each other instead of piling up
    });

    await Promise.allSettled((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      } catch (e) {
        // the phone removed its subscription: forget it
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push failed", e?.statusCode, e?.body);
      }
    }));
  } catch (e) {
    console.error(e);
  }
  return done();
});

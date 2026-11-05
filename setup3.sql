-- Phone notifications ("sabari shared a new reel").
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Do it after setup.sql and setup2.sql. Safe to run twice.

create extension if not exists pg_net with schema extensions;

-- remembers that a card has already been announced, so nobody gets it twice
alter table items add column if not exists notified_at timestamptz;

-- one row per phone/browser that turned notifications on
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table push_subscriptions enable row level security;
drop policy if exists "push read own" on push_subscriptions;
create policy "push read own" on push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push insert own" on push_subscriptions;
create policy "push insert own" on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "push update own" on push_subscriptions;
create policy "push update own" on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push delete own" on push_subscriptions;
create policy "push delete own" on push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- every time a card is saved, tell the Supabase function "notify-new-item" (it sends the notifications)
create or replace function notify_new_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'note' then
    perform net.http_post(
      url := 'https://tpildkammrydgaubgzol.supabase.co/functions/v1/notify-new-item',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaWxka2FtbXJ5ZGdhdWJnem9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MzU1MTEsImV4cCI6MjEwOTAxMTUxMX0.Izil1A-FxAkiYnLQ-abxI1CeZAxP1CXi3enDUHNe7d4'
      ),
      body := jsonb_build_object('item_id', new.id)
    );
  end if;
  return new;
exception when others then
  return new; -- a notification problem must never stop a card from being saved
end $$;

drop trigger if exists items_notify on items;
create trigger items_notify after insert on items for each row execute function notify_new_item();

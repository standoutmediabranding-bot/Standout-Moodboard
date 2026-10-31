-- Run AFTER setup.sql. Supabase: SQL Editor -> New query -> paste -> Run. Safe to run more than once.

-- ---------- profiles (name + avatar for each member) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  color text not null default '#1fd35e',
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "read profiles" on profiles;
create policy "read profiles" on profiles for select to authenticated using (true);
drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name) values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
insert into profiles (id, name) select id, split_part(email, '@', 1) from auth.users on conflict do nothing;

-- ---------- items: note, tags, status, trash, cover ----------
alter table items add column if not exists note text;            -- "why I saved this"
alter table items add column if not exists tags text[] not null default '{}';
alter table items add column if not exists status text;          -- to-try / using / used
alter table items add column if not exists deleted_at timestamptz; -- trash
alter table items add column if not exists thumb_url text;       -- cover image for reels that can't play
alter table boards add column if not exists archived boolean not null default false;
alter table boards add column if not exists description text;

-- people can only trash / delete their own items; trash is hidden from others
drop policy if exists "team items" on items;
drop policy if exists "items read" on items;
create policy "items read" on items for select to authenticated using (true);
drop policy if exists "items insert" on items;
create policy "items insert" on items for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "items update" on items;
create policy "items update" on items for update to authenticated
  using (deleted_at is null or created_by = auth.uid())
  with check (deleted_at is null or created_by = auth.uid());
drop policy if exists "items delete" on items;
create policy "items delete" on items for delete to authenticated using (created_by = auth.uid());

-- boards: anyone can add/rename/archive, only the creator can delete
drop policy if exists "team boards" on boards;
drop policy if exists "boards read" on boards;
create policy "boards read" on boards for select to authenticated using (true);
drop policy if exists "boards insert" on boards;
create policy "boards insert" on boards for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "boards update" on boards;
create policy "boards update" on boards for update to authenticated using (true) with check (true);
drop policy if exists "boards delete" on boards;
create policy "boards delete" on boards for delete to authenticated using (created_by = auth.uid());

-- ---------- comments, reactions, favourites ----------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_item_idx on comments(item_id);
alter table comments enable row level security;
drop policy if exists "comments read" on comments;
create policy "comments read" on comments for select to authenticated using (true);
drop policy if exists "comments insert" on comments;
create policy "comments insert" on comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "comments delete" on comments;
create policy "comments delete" on comments for delete to authenticated using (user_id = auth.uid());

create table if not exists reactions (
  item_id uuid not null references items(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, emoji)
);
alter table reactions enable row level security;
drop policy if exists "reactions read" on reactions;
create policy "reactions read" on reactions for select to authenticated using (true);
drop policy if exists "reactions insert" on reactions;
create policy "reactions insert" on reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reactions delete" on reactions;
create policy "reactions delete" on reactions for delete to authenticated using (user_id = auth.uid());

create table if not exists favourites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table favourites enable row level security;
drop policy if exists "fav read" on favourites;
create policy "fav read" on favourites for select to authenticated using (user_id = auth.uid());
drop policy if exists "fav insert" on favourites;
create policy "fav insert" on favourites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "fav delete" on favourites;
create policy "fav delete" on favourites for delete to authenticated using (user_id = auth.uid());

-- ---------- live sync for the new tables ----------
alter table comments replica identity full;
alter table reactions replica identity full;
do $$ begin alter publication supabase_realtime add table comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table profiles;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table boards;    exception when duplicate_object then null; end $$;

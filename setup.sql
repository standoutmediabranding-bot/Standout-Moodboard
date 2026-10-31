-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  type text not null check (type in ('image','video','note','link','embed')),
  url text,
  path text,            -- storage path, set for uploaded files
  text text,
  x real not null default 0,
  y real not null default 0,
  w real not null default 240,
  h real not null default 180,
  z int not null default 0,
  author text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists items_board_idx on items(board_id);

-- Everyone who can sign in is "the team": full access to all boards.
alter table boards enable row level security;
alter table items enable row level security;

drop policy if exists "team boards" on boards;
create policy "team boards" on boards for all to authenticated using (true) with check (true);
drop policy if exists "team items" on items;
create policy "team items" on items for all to authenticated using (true) with check (true);

-- Live sync
alter table items replica identity full;
alter publication supabase_realtime add table items;

-- File storage (public-read bucket; file URLs contain a random id and are not listed anywhere)
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do nothing;

drop policy if exists "team upload" on storage.objects;
create policy "team upload" on storage.objects for insert to authenticated with check (bucket_id = 'media');
drop policy if exists "team delete" on storage.objects;
create policy "team delete" on storage.objects for delete to authenticated using (bucket_id = 'media');

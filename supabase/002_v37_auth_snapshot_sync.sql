-- SIAGA GURU v3.7 — Supabase Auth + Snapshot Sync v1
-- Jalankan SETELAH 001_siaga_cloud_schema.sql

create table if not exists public.workspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_code text,
  device_id text,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.workspace_snapshots enable row level security;

drop policy if exists workspace_snapshot_owner_select on public.workspace_snapshots;
create policy workspace_snapshot_owner_select
on public.workspace_snapshots for select to authenticated
using (user_id = auth.uid());

drop policy if exists workspace_snapshot_owner_insert on public.workspace_snapshots;
create policy workspace_snapshot_owner_insert
on public.workspace_snapshots for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists workspace_snapshot_owner_update on public.workspace_snapshots;
create policy workspace_snapshot_owner_update
on public.workspace_snapshots for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.touch_workspace_snapshot()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then new.revision = old.revision + 1; end if;
  return new;
end;
$$;

drop trigger if exists trg_workspace_snapshot_touch on public.workspace_snapshots;
create trigger trg_workspace_snapshot_touch
before insert or update on public.workspace_snapshots
for each row execute function public.touch_workspace_snapshot();

-- SIAGA GURU v3.6 — Cloud Ready
create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'teacher' check (role in ('admin','principal','teacher','homeroom','supervisor')),
  created_at timestamptz not null default now(),
  unique (school_id,user_id)
);

create table if not exists public.teacher_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  full_name text, teacher_id text, subject text, role_label text,
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_periods (
  id uuid primary key default gen_random_uuid(), client_id uuid unique,
  school_id uuid not null references public.schools(id) on delete cascade,
  year text not null, semester text not null, is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, updated_at timestamptz not null default now(), unique (school_id,name)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  nis text, name text not null, gender text, birth_place text, birth_date date,
  status text default 'active', updated_at timestamptz not null default now()
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  period_id uuid references public.academic_periods(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_id uuid references public.academic_periods(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null, status text not null, note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_id uuid references public.academic_periods(id) on delete cascade,
  class_name text, subject text, journal_date date, topic text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_id uuid references public.academic_periods(id) on delete cascade,
  title text not null, assessment_type text, class_name text, kkm numeric,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score numeric, remedial_score numeric, final_score numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.homeroom_notes (
  id uuid primary key default gen_random_uuid(), client_id uuid unique not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  category text, note text, payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.schools enable row level security;
alter table public.memberships enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.academic_periods enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.attendance enable row level security;
alter table public.journals enable row level security;
alter table public.assessments enable row level security;
alter table public.grades enable row level security;
alter table public.homeroom_notes enable row level security;

create or replace function public.is_school_member(target_school uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships m where m.school_id=target_school and m.user_id=auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['academic_periods','classes','students','student_enrollments','attendance','journals','assessments','grades','homeroom_notes']
  loop
    execute format('drop policy if exists school_member_all on public.%I',t);
    execute format('create policy school_member_all on public.%I for all to authenticated using (public.is_school_member(school_id)) with check (public.is_school_member(school_id))',t);
  end loop;
end $$;

drop policy if exists membership_self_read on public.memberships;
create policy membership_self_read on public.memberships for select to authenticated using (user_id=auth.uid());

drop policy if exists teacher_profile_self on public.teacher_profiles;
create policy teacher_profile_self on public.teacher_profiles for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists schools_member_read on public.schools;
create policy schools_member_read on public.schools for select to authenticated using (public.is_school_member(id));

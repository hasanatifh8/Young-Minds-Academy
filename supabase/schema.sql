-- =====================================================================
-- Young Minds Academy — Exam Vault (Supabase / Postgres)
-- Run this once in Supabase: Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates the policies and functions.
-- =====================================================================

-- ---------- Enums ----------
do $$ begin
  create type board_type as enum ('CBSE', 'ICSE', 'ISC', 'STATE_BOARD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type paper_category as enum ('PYQ_OFFICIAL', 'GUESS_PAPER', 'SAMPLE_PAPER', 'PRE_BOARD_MASTERS', 'CHAPTERWISE_PYQ');
exception when duplicate_object then null; end $$;

do $$ begin
  create type solution_type as enum ('NONE', 'INCLUDED_IN_MAIN_PDF', 'SEPARATE_SOLUTION_PDF');
exception when duplicate_object then null; end $$;

do $$ begin
  create type paper_status as enum ('DRAFT', 'PUBLISHED', 'SCHEDULED');
exception when duplicate_object then null; end $$;

-- ---------- Profiles & roles ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       text not null default 'STUDENT' check (role in ('STUDENT', 'ADMIN', 'SUPER_ADMIN')),
  created_at timestamptz not null default now()
);

-- New sign-ups get a STUDENT profile. Promote admins manually (see bottom of file).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Back-fill profiles for users created before this script was run.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('ADMIN', 'SUPER_ADMIN')
  );
$$;

-- ---------- Question papers ----------
create table if not exists public.question_papers (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  board              board_type not null,
  class_grade        int not null check (class_grade in (9, 10, 11, 12, 13)), -- 13 = Dropper / Target
  subject            text not null,
  category           paper_category not null,
  exam_year          int not null check (exam_year between 2015 and 2035),
  paper_set          text,            -- "Set 1", "Code 30/1/1"
  region             text,            -- "Delhi", "Outside Delhi", "Term-1", ...
  tags               text[] not null default '{}',
  question_pdf_path  text not null,   -- path inside the "papers" storage bucket
  solution_pdf_path  text,
  solution_type      solution_type not null default 'NONE',
  solution_video_url text,
  file_size_mb       numeric(6, 2),
  download_count     int not null default 0,
  is_featured        boolean not null default false,
  is_recommended     boolean not null default false,
  is_lead_gated      boolean not null default false,
  status             paper_status not null default 'DRAFT',
  scheduled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  uploaded_by        uuid references auth.users (id) default auth.uid(),
  constraint scheduled_needs_time check (status <> 'SCHEDULED' or scheduled_at is not null)
);

create index if not exists question_papers_board_class_subject on public.question_papers (board, class_grade, subject);
create index if not exists question_papers_category_year on public.question_papers (category, exam_year);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists question_papers_touch on public.question_papers;
create trigger question_papers_touch
  before update on public.question_papers
  for each row execute function public.touch_updated_at();

-- A paper is visible to the public once published, or once its scheduled time has passed.
create or replace function public.paper_is_visible(p public.question_papers)
returns boolean language sql stable as $$
  select p.status = 'PUBLISHED' or (p.status = 'SCHEDULED' and p.scheduled_at <= now());
$$;

-- ---------- Leads (WhatsApp numbers captured before download) ----------
create table if not exists public.paper_leads (
  id          uuid primary key default gen_random_uuid(),
  paper_id    uuid references public.question_papers (id) on delete set null,
  whatsapp    text not null check (whatsapp ~ '^[6-9][0-9]{9}$'),
  student_name text check (char_length(student_name) <= 80),
  class_grade int,
  created_at  timestamptz not null default now()
);
create index if not exists paper_leads_created on public.paper_leads (created_at desc);

-- ---------- Row Level Security ----------
alter table public.profiles        enable row level security;
alter table public.question_papers enable row level security;
alter table public.paper_leads     enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "papers: public reads visible" on public.question_papers;
create policy "papers: public reads visible" on public.question_papers
  for select using (public.paper_is_visible(question_papers) or public.is_admin());

drop policy if exists "papers: admins insert" on public.question_papers;
create policy "papers: admins insert" on public.question_papers
  for insert with check (public.is_admin());

drop policy if exists "papers: admins update" on public.question_papers;
create policy "papers: admins update" on public.question_papers
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "papers: admins delete" on public.question_papers;
create policy "papers: admins delete" on public.question_papers
  for delete using (public.is_admin());

drop policy if exists "leads: anyone can submit" on public.paper_leads;
create policy "leads: anyone can submit" on public.paper_leads
  for insert with check (true);

drop policy if exists "leads: admins read" on public.paper_leads;
create policy "leads: admins read" on public.paper_leads
  for select using (public.is_admin());

drop policy if exists "leads: admins delete" on public.paper_leads;
create policy "leads: admins delete" on public.paper_leads
  for delete using (public.is_admin());

-- ---------- Download counter (callable by anyone, only for visible papers) ----------
create or replace function public.increment_download(paper_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare new_count int;
begin
  update public.question_papers p
     set download_count = download_count + 1
   where p.id = paper_id and public.paper_is_visible(p)
  returning download_count into new_count;
  return new_count;
end $$;

grant execute on function public.increment_download(uuid) to anon, authenticated;

-- ---------- Storage bucket for PDFs ----------
-- Public read so students can view/download; only admins can upload, replace or delete.
-- 25 MB limit, PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', true, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = true, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

drop policy if exists "papers bucket: public read" on storage.objects;
create policy "papers bucket: public read" on storage.objects
  for select using (bucket_id = 'papers');

drop policy if exists "papers bucket: admins upload" on storage.objects;
create policy "papers bucket: admins upload" on storage.objects
  for insert with check (bucket_id = 'papers' and public.is_admin());

drop policy if exists "papers bucket: admins update" on storage.objects;
create policy "papers bucket: admins update" on storage.objects
  for update using (bucket_id = 'papers' and public.is_admin());

drop policy if exists "papers bucket: admins delete" on storage.objects;
create policy "papers bucket: admins delete" on storage.objects
  for delete using (bucket_id = 'papers' and public.is_admin());

-- =====================================================================
-- MAKE YOURSELF AN ADMIN
-- 1. Supabase Dashboard → Authentication → Users → "Add user" (email + password).
-- 2. Run (with your email):
--      update public.profiles set role = 'SUPER_ADMIN'
--      where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================

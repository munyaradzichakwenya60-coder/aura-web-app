-- Run this in your Supabase dashboard → SQL Editor

-- User profiles: stores role, onboarding answers, preferences
create table if not exists public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  use_case     text check (use_case in ('personal', 'developer', 'student', 'business', 'other')),
  role         text not null default 'user' check (role in ('user', 'admin')),
  onboarded    boolean not null default false,
  agreed_policy boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Row-level security: users can only read/write their own profile
alter table public.user_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Content policy violation log
create table if not exists public.policy_violations (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id),
  user_email text,
  message    text,
  reason     text,
  created_at timestamptz not null default now()
);

alter table public.policy_violations enable row level security;

-- Only admins can read violations (set via service role in API routes)
create policy "Admin read violations"
  on public.policy_violations for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- IMPORTANT: After running this, manually set your own account as admin:
-- update public.user_profiles set role = 'admin' where email = 'YOUR_EMAIL_HERE';

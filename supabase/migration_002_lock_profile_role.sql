-- Run this in your Supabase dashboard -> SQL Editor (after migration_user_profiles.sql).
--
-- Problem: the original policies let a signed-in user update or insert *any* column of
-- their own user_profiles row, including `role`. Anyone could run
--   update user_profiles set role = 'admin' where id = auth.uid();
-- from the browser and make themselves an admin.
--
-- Fix: signed-in users may only write the harmless columns. `role` (and `email`) can
-- only be changed with the service role or from the SQL editor.

revoke insert, update on public.user_profiles from anon, authenticated;

grant insert (id, display_name, use_case, onboarded, agreed_policy, updated_at)
  on public.user_profiles to authenticated;

grant update (display_name, use_case, onboarded, agreed_policy, updated_at)
  on public.user_profiles to authenticated;

-- Defence in depth: a row a user inserts for themselves can never start as an admin.
drop policy if exists "Users can insert own profile" on public.user_profiles;
create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id and role = 'user');

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- (the column grants above are what actually stop `role` from being changed)

-- To make yourself an admin (SQL editor only):
-- update public.user_profiles set role = 'admin' where email = 'YOUR_EMAIL_HERE';

-- Client profile edits are limited to names. Existing roles and server grants are preserved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Table grants override column restrictions; remove both kinds of client UPDATE grants.
revoke update on public.profiles from public, anon, authenticated;
revoke update (id, email, name, role, created_at) on public.profiles from public, anon, authenticated;
grant update (name) on public.profiles to authenticated;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

notify pgrst, 'reload schema';
commit;

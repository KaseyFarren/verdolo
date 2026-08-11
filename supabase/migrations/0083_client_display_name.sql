-- Client portal, part 5: a name for the client contact, settable by either side.
--
-- Team side already sees "-" for a client's messages in the full Messages view (memberName()
-- falls back to '-' when the sender isn't in org_members - a client never is). Giving
-- client_users a display_name, editable by an org admin (inviting or later) or by the client
-- themself, fixes that at the source rather than patching each place a name gets shown.
--
-- Self-update mirrors org_members' pattern exactly (0011_profiles.sql): a permissive
-- user_id-scoped policy plus a guard trigger that blocks using it to change anything but the
-- name (status/org/client/user are still admin- or system-only).

alter table client_users add column display_name text;

create policy client_users_update on client_users for update
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

create policy client_users_update_own on client_users for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function guard_client_user_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_org_admin(old.org_id) then
    if new.status is distinct from old.status
      or new.org_id is distinct from old.org_id
      or new.client_id is distinct from old.client_id
      or new.user_id is distinct from old.user_id
      or new.invited_email is distinct from old.invited_email then
      raise exception 'cannot change status, org, client, user, or invited email via self-update';
    end if;
  end if;
  return new;
end;
$$;

create trigger client_users_guard_self_update before update on client_users
  for each row execute function guard_client_user_self_update();

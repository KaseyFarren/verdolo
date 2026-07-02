-- The 0011 self-update guard trigger fired for service-role/SQL-editor writes too (where
-- auth.uid() is null), blocking legitimate admin-side fixes since is_org_admin() can never be
-- true for a null user. Service-role requests already bypass RLS entirely and are trusted by
-- definition, so the guard should only constrain real authenticated browser requests.

create or replace function guard_org_member_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not is_org_admin(old.org_id) then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.org_id is distinct from old.org_id
      or new.user_id is distinct from old.user_id then
      raise exception 'cannot change role, status, org, or user via self-update';
    end if;
  end if;
  return new;
end;
$$;

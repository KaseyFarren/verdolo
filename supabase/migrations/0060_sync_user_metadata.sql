-- Mirrors org_members.role and .display_name onto auth.users.raw_user_meta_data so they're
-- visible in Supabase Studio's Authentication > Users panel, not just queryable via org_members.
-- Single-org-per-user model (see requireOrgContext), so each auth user maps to at most one
-- org_members row - no ambiguity about which org's role to show.

create or replace function sync_user_metadata_from_org_member()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', new.role, 'display_name', new.display_name)
  where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists org_members_sync_user_metadata on org_members;
create trigger org_members_sync_user_metadata after insert or update on org_members
  for each row execute function sync_user_metadata_from_org_member();

-- backfill existing members
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', m.role, 'display_name', m.display_name)
from org_members m
where m.user_id = u.id;

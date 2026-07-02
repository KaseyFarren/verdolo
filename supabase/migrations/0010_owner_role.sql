-- Adds a top-tier 'owner' role above 'admin'. The org creator (previously 'admin', the only
-- role that existed) becomes 'owner'. 'admin' is now a middle tier: can see teammates and edit
-- clients, but can't touch revenue (MRR/invoices) or manage/see other owners. 'member' can see
-- clients read-only and only their own time entries.

alter table org_members drop constraint if exists org_members_role_check;
alter table org_members add constraint org_members_role_check check (role in ('owner', 'admin', 'member'));

-- existing admins predate the owner tier and were the org's sole full-control user; promote them
update org_members set role = 'owner' where role = 'admin';

create or replace function is_org_admin(target_org_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org_id and user_id = auth.uid() and status = 'active' and role in ('admin', 'owner')
  );
$$;

create or replace function is_org_owner(target_org_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org_id and user_id = auth.uid() and status = 'active' and role = 'owner'
  );
$$;

create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());
  return new_org_id;
end;
$$;

-- clients: members can view but no longer create/edit (delete stays admin+owner, unchanged)
drop policy if exists clients_write on clients;
create policy clients_write on clients for insert with check (is_org_admin(org_id));

drop policy if exists clients_update on clients;
create policy clients_update on clients for update using (is_org_admin(org_id));

-- org_members SELECT stays is_org_member (unchanged) — tasks/time pages already resolve
-- assignee/teammate emails for every member via this table, so restricting reads here would
-- break task assignment for members without adding real protection. The dedicated team roster
-- UI (/team) is instead gated at the app layer to admins/owners.
--
-- Writes are tightened: admins can manage admins/members but can't create, promote to, or
-- touch existing owner rows (only another owner can).
drop policy if exists org_members_insert on org_members;
create policy org_members_insert on org_members for insert
  with check (is_org_admin(org_id) and (role <> 'owner' or is_org_owner(org_id)));

drop policy if exists org_members_update on org_members;
create policy org_members_update on org_members for update
  using (is_org_admin(org_id) and (role <> 'owner' or is_org_owner(org_id)))
  with check (is_org_admin(org_id) and (role <> 'owner' or is_org_owner(org_id)));

drop policy if exists org_members_delete on org_members;
create policy org_members_delete on org_members for delete
  using (is_org_admin(org_id) and (role <> 'owner' or is_org_owner(org_id)));

-- time_entries: members only ever see their own; admins/owners see the whole org
drop policy if exists time_entries_select on time_entries;
create policy time_entries_select on time_entries for select
  using (user_id = auth.uid() or is_org_admin(org_id));

-- invoices are revenue documents: owner-only, tightened from admin-only
drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select using (is_org_owner(org_id));

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (is_org_owner(org_id)) with check (is_org_owner(org_id));

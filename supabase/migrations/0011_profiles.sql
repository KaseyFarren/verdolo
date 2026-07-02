-- Member profiles (nickname + avatar) and assignee-scoped task visibility.

-- ============ PROFILES ============

alter table org_members add column if not exists display_name text;
alter table org_members add column if not exists avatar_url text;

-- Members can edit their own display_name/avatar_url, but the existing org_members_update
-- policy (admin-managing-others) requires is_org_admin, so it doesn't cover self-edits.
-- Add a permissive self-update policy, then a trigger to stop that policy from being used to
-- sneak in a role/status/org/user change (Postgres OR's permissive policies together, so
-- without the trigger a member could PATCH their own role via this policy).
create policy org_members_update_own_profile on org_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function guard_org_member_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
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

drop trigger if exists org_members_guard_self_update on org_members;
create trigger org_members_guard_self_update before update on org_members
  for each row execute function guard_org_member_self_update();

-- avatars: public bucket, uploads restricted to a per-user folder (avatars/{user_id}/...)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============ ASSIGNEE-SCOPED TASK VISIBILITY ============
-- members only see/mutate tasks assigned to them or unassigned (shared queue, incl. the
-- daily AI check-ins and any recurring template with no assignee); admins/owners see everything

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (assigned_to = auth.uid() or assigned_to is null or is_org_admin(org_id));

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (assigned_to = auth.uid() or assigned_to is null or is_org_admin(org_id));

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete
  using (assigned_to = auth.uid() or assigned_to is null or is_org_admin(org_id));

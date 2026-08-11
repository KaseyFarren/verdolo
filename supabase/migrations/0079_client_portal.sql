-- Client portal, part 1: identity + read access + messaging.
--
-- Clients get their own auth users, distinct from org_members. A client_users row links a
-- Supabase auth user to exactly one clients row (mirrors org_members' invited/active shape).
-- They get read-only visibility into their own projects/phases/tasks and their own files
-- (upload allowed, matching how org members already use client_files), plus a per-client
-- "team channel" analog and the ability to DM individual org members.
--
-- Cross-client isolation is structural, not just RLS: DM/participant rows are the only way
-- two users share a thread, and guard_client_thread_participant() below refuses to ever put
-- two different clients' users in the same thread. A client_user simply has no path to a
-- thread that contains another client.

create table client_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_email text,
  status text not null check (status in ('invited', 'active')) default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);
create index client_users_client_id_idx on client_users(client_id);
create index client_users_user_id_idx on client_users(user_id);

create or replace function is_client_user(target_client_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from client_users
    where client_id = target_client_id and user_id = auth.uid() and status = 'active'
  );
$$;

-- caller's own client_id, if they're an active client user (null otherwise) - lets policies
-- and functions branch on "am I a client user, and which client" without a second round trip
create or replace function my_client_id()
returns uuid
language sql security definer stable set search_path = public as $$
  select client_id from client_users where user_id = auth.uid() and status = 'active' limit 1;
$$;

alter table client_users enable row level security;

create policy client_users_select on client_users for select
  using (is_org_member(org_id) or user_id = auth.uid());

-- ============ READ ACCESS: projects, phases, tasks, files ============
-- Additive to the existing is_org_member policies (projects_all / project_phases_all /
-- tasks_select / client_files_*) - these only ever widen access for a client's own rows,
-- never narrow what org members already see.

create policy projects_client_select on projects for select
  using (client_id is not null and is_client_user(client_id));

create policy project_phases_client_select on project_phases for select
  using (exists (
    select 1 from projects p where p.id = project_phases.project_id
      and p.client_id is not null and is_client_user(p.client_id)
  ));

create policy tasks_client_select on tasks for select
  using (client_id is not null and is_client_user(client_id));

create policy client_files_client_select on client_files for select
  using (is_client_user(client_id));

create policy client_files_client_insert on client_files for insert
  with check (is_client_user(client_id));

create policy client_files_storage_client_select on storage.objects for select to authenticated
  using (bucket_id = 'client-files' and is_client_user((storage.foldername(name))[2]::uuid));

create policy client_files_storage_client_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and is_client_user((storage.foldername(name))[2]::uuid));

-- ============ MESSAGING: per-client channel + client<->team DMs ============

alter table message_threads drop constraint message_threads_kind_check;
alter table message_threads add constraint message_threads_kind_check
  check (kind in ('team', 'dm', 'client'));
alter table message_threads add column client_id uuid references clients(id) on delete cascade;
-- exactly one client-channel per client, mirroring the one-team-channel-per-org index
create unique index message_threads_one_per_client on message_threads(client_id) where kind = 'client';

create or replace function can_access_thread(target_thread_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from message_threads t
    where t.id = target_thread_id
      and (
        (t.kind = 'team' and is_org_member(t.org_id))
        or (t.kind = 'dm' and is_thread_participant(t.id))
        or (t.kind = 'client' and (is_org_member(t.org_id) or is_client_user(t.client_id)))
      )
  );
$$;

drop policy if exists message_threads_select on message_threads;
create policy message_threads_select on message_threads for select
  using (
    (kind = 'team' and is_org_member(org_id))
    or (kind = 'dm' and is_thread_participant(id))
    or (kind = 'client' and (is_org_member(org_id) or is_client_user(client_id)))
  );

-- lazily creates (or returns) the one client-channel for a client. Callable by any org member
-- or by that client's own users - both sides need this to open the thread the first time.
create or replace function get_or_create_client_thread(target_client_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  client_org_id uuid;
  found_thread_id uuid;
  new_thread_id uuid;
begin
  select org_id into client_org_id from clients where id = target_client_id;
  if client_org_id is null then
    raise exception 'client not found';
  end if;

  if not (is_org_member(client_org_id) or is_client_user(target_client_id)) then
    raise exception 'not authorized for this client';
  end if;

  select id into found_thread_id from message_threads
    where kind = 'client' and client_id = target_client_id;
  if found_thread_id is not null then
    return found_thread_id;
  end if;

  insert into message_threads (org_id, kind, client_id) values (client_org_id, 'client', target_client_id)
    returning id into new_thread_id;
  return new_thread_id;
end;
$$;

-- finds (or creates) a 1:1 DM between a client user and an org member of that client's org.
-- Distinct from get_or_create_dm_thread (team<->team): this one only ever pairs a client with
-- an org member, in either calling direction, so two client users can never end up paired.
create or replace function get_or_create_client_dm_thread(other_user_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  caller_client_id uuid;
  target_org_id uuid;
  found_thread_id uuid;
  new_thread_id uuid;
begin
  if other_user_id = auth.uid() then
    raise exception 'cannot DM yourself';
  end if;

  caller_client_id := my_client_id();

  if caller_client_id is not null then
    -- caller is a client user; other_user_id must be an active org member of that client's org
    select org_id into target_org_id from clients where id = caller_client_id;
    if not exists (
      select 1 from org_members where org_id = target_org_id and user_id = other_user_id and status = 'active'
    ) then
      raise exception 'can only message team members';
    end if;
  else
    -- caller must be an org member; other_user_id must be an active client user of that org
    select cu.client_id into caller_client_id
      from client_users cu join clients c on c.id = cu.client_id
      where cu.user_id = other_user_id and cu.status = 'active' and is_org_member(c.org_id);
    if caller_client_id is null then
      raise exception 'other user is not a client of your org';
    end if;
    select org_id into target_org_id from clients where id = caller_client_id;
  end if;

  select t.id into found_thread_id
  from message_threads t
  where t.org_id = target_org_id and t.kind = 'dm'
    and exists (select 1 from message_thread_participants p where p.thread_id = t.id and p.user_id = auth.uid())
    and exists (select 1 from message_thread_participants p where p.thread_id = t.id and p.user_id = other_user_id)
    and (select count(*) from message_thread_participants p where p.thread_id = t.id) = 2
  limit 1;

  if found_thread_id is not null then
    return found_thread_id;
  end if;

  insert into message_threads (org_id, kind) values (target_org_id, 'dm') returning id into new_thread_id;
  insert into message_thread_participants (thread_id, user_id)
    values (new_thread_id, auth.uid()), (new_thread_id, other_user_id);
  return new_thread_id;
end;
$$;

-- Belt-and-suspenders: even if some future code path inserts participant rows directly,
-- refuse to ever seat two different clients' users in the same thread.
create or replace function guard_client_thread_participant()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_client_id uuid;
  existing_other_client_id uuid;
begin
  select client_id into new_client_id from client_users
    where user_id = new.user_id and status = 'active' limit 1;

  if new_client_id is null then
    return new; -- participant is a regular org user, nothing to guard
  end if;

  select cu.client_id into existing_other_client_id
    from message_thread_participants p
    join client_users cu on cu.user_id = p.user_id and cu.status = 'active'
    where p.thread_id = new.thread_id and cu.client_id is distinct from new_client_id
    limit 1;

  if existing_other_client_id is not null then
    raise exception 'a thread cannot contain users from more than one client';
  end if;

  return new;
end;
$$;

create trigger message_thread_participants_guard_client before insert on message_thread_participants
  for each row execute function guard_client_thread_participant();

alter table client_users replica identity full;
alter publication supabase_realtime add table client_users;

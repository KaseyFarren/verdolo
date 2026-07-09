-- Team messaging: one shared "Team" channel per org, plus 1:1 direct messages between
-- members. Single-org-per-user model (see requireOrgContext), so DM lookup doesn't need an
-- explicit org_id param - it's derived from the caller's own active membership.

create table message_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('team', 'dm')),
  created_at timestamptz not null default now()
);
create index message_threads_org_id_idx on message_threads(org_id);
-- exactly one team channel per org
create unique index message_threads_one_team_per_org on message_threads(org_id) where kind = 'team';

-- only used for kind='dm' threads, to record the two participants
create table message_thread_participants (
  thread_id uuid not null references message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (thread_id, user_id)
);
create index message_thread_participants_user_id_idx on message_thread_participants(user_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references message_threads(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index messages_thread_id_created_at_idx on messages(thread_id, created_at);
create index messages_org_id_idx on messages(org_id);

-- ============ RLS HELPERS ============

create or replace function is_thread_participant(target_thread_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from message_thread_participants
    where thread_id = target_thread_id and user_id = auth.uid()
  );
$$;

create or replace function can_access_thread(target_thread_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from message_threads t
    where t.id = target_thread_id
      and (
        (t.kind = 'team' and is_org_member(t.org_id))
        or (t.kind = 'dm' and is_thread_participant(t.id))
      )
  );
$$;

-- finds (or lazily creates) the 1:1 DM thread between the caller and another active member
-- of the caller's org. security definer so it can insert the thread + both participant rows
-- in one shot without the caller needing direct insert rights on message_thread_participants.
create or replace function get_or_create_dm_thread(other_user_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  my_org_id uuid;
  found_thread_id uuid;
  new_thread_id uuid;
begin
  select org_id into my_org_id from org_members
    where user_id = auth.uid() and status = 'active';

  if my_org_id is null then
    raise exception 'not an active org member';
  end if;

  if other_user_id = auth.uid() then
    raise exception 'cannot DM yourself';
  end if;

  if not exists (
    select 1 from org_members
    where org_id = my_org_id and user_id = other_user_id and status = 'active'
  ) then
    raise exception 'other user is not an active member of your org';
  end if;

  select t.id into found_thread_id
  from message_threads t
  where t.org_id = my_org_id and t.kind = 'dm'
    and exists (select 1 from message_thread_participants p where p.thread_id = t.id and p.user_id = auth.uid())
    and exists (select 1 from message_thread_participants p where p.thread_id = t.id and p.user_id = other_user_id)
    and (select count(*) from message_thread_participants p where p.thread_id = t.id) = 2
  limit 1;

  if found_thread_id is not null then
    return found_thread_id;
  end if;

  insert into message_threads (org_id, kind) values (my_org_id, 'dm') returning id into new_thread_id;
  insert into message_thread_participants (thread_id, user_id)
    values (new_thread_id, auth.uid()), (new_thread_id, other_user_id);
  return new_thread_id;
end;
$$;

-- ============ CREATE_ORG: also bootstrap the org's team channel ============

create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());
  insert into message_threads (org_id, kind) values (new_org_id, 'team');
  return new_org_id;
end;
$$;

-- backfill a team channel for every org that predates this migration
insert into message_threads (org_id, kind)
select o.id, 'team' from orgs o
where not exists (select 1 from message_threads t where t.org_id = o.id and t.kind = 'team');

-- ============ RLS ============

alter table message_threads enable row level security;
alter table message_thread_participants enable row level security;
alter table messages enable row level security;

create policy message_threads_select on message_threads for select
  using ((kind = 'team' and is_org_member(org_id)) or (kind = 'dm' and is_thread_participant(id)));

create policy message_thread_participants_select on message_thread_participants for select
  using (is_thread_participant(thread_id));

create policy messages_select on messages for select
  using (can_access_thread(thread_id));

create policy messages_insert on messages for insert
  with check (sender_id = auth.uid() and can_access_thread(thread_id));

create policy messages_delete on messages for delete
  using (sender_id = auth.uid());

-- live updates in the Messages UI
alter publication supabase_realtime add table messages;

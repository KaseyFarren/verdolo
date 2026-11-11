-- Client portal, part 6: a shared task list between the team and a client.
--
--   * tasks.client_visible - show this task in the client's portal even without a project
--     (recurring jobs like "Publish podcast episode", ad-hoc items).
--   * tasks.for_client     - the client's own to-do ("waiting on you"); the client can tick it.
--   * tasks.requested_by   - a client user who added this task from the portal ("for the team").
--   * recurring_templates.client_visible / for_client - copied onto each generated instance.
--   * task_comments        - comments on a task, visible to whoever can see the task.
--   * notification_log     - service-role-only record of sent emails, used to throttle.
--   * client_users.daily_digest - the client's own on/off for the morning email.
--
-- Also tightens tasks_client_select: a client used to be able to read EVERY task tagged with
-- their client_id (including internal ones - kick-off notes, onboarding "get access" tasks,
-- contract reminders) straight from the API; the portal only hid them in its own query.
-- Now RLS itself only exposes portal tasks.

alter table tasks add column client_visible boolean not null default false;
alter table tasks add column for_client boolean not null default false;
alter table tasks add column requested_by uuid references auth.users(id) on delete set null;

alter table recurring_templates add column client_visible boolean not null default false;
alter table recurring_templates add column for_client boolean not null default false;

alter table client_users add column daily_digest boolean not null default true;

-- ============ What a client can see ============

drop policy if exists tasks_client_select on tasks;
create policy tasks_client_select on tasks for select
  using (
    client_id is not null and is_client_user(client_id)
    and parent_task_id is null and not archived
    and (
      client_visible or for_client or requested_by is not null
      or (project_id is not null and exists (
        select 1 from projects p where p.id = tasks.project_id and p.client_id = tasks.client_id
      ))
    )
  );

-- ============ What a client can do (narrow RPCs, no direct write policies) ============

-- Adds a task for the team from the portal. Lands with the client's owner (Clients > Owner),
-- else the org's owner/admin, so it shows up on someone's list straight away.
create or replace function client_add_task(p_title text, p_notes text default null, p_due date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_client_id();
  oid uuid;
  assignee uuid;
  new_id uuid;
  clean_title text := btrim(coalesce(p_title, ''));
begin
  if cid is null then raise exception 'not a client user'; end if;
  if length(clean_title) = 0 or length(clean_title) > 200 then raise exception 'title must be 1-200 characters'; end if;
  if p_notes is not null and length(p_notes) > 2000 then raise exception 'notes too long'; end if;
  if p_due is not null and (p_due < current_date - 1 or p_due > current_date + 730) then raise exception 'due date out of range'; end if;

  select c.org_id, c.assigned_to into oid, assignee from clients c where c.id = cid;
  if assignee is not null and not exists (
    select 1 from org_members m where m.org_id = oid and m.user_id = assignee and m.status = 'active'
  ) then
    assignee := null;
  end if;
  if assignee is null then
    select m.user_id into assignee from org_members m
      where m.org_id = oid and m.status = 'active' and m.role in ('owner', 'admin')
      order by case m.role when 'owner' then 0 else 1 end, m.created_at
      limit 1;
  end if;

  insert into tasks (org_id, client_id, title, notes, due_date, original_due_date, priority, done, status,
                     assigned_to, assignee_ids, client_visible, requested_by)
  values (oid, cid, clean_title, coalesce(btrim(p_notes), ''), coalesce(p_due, current_date), coalesce(p_due, current_date),
          'Medium', false, 'todo', assignee, case when assignee is null then '{}'::uuid[] else array[assignee] end,
          true, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Ticks (or un-ticks) one of the client's own to-dos. Nothing else is client-editable.
create or replace function client_set_task_done(p_task_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_client_id();
begin
  if cid is null then raise exception 'not a client user'; end if;
  update tasks
    set done = p_done,
        completed_at = case when p_done then now() else null end,
        status = case when p_done then 'done' else 'todo' end
    where id = p_task_id and client_id = cid and for_client and parent_task_id is null and not archived;
  if not found then raise exception 'task not found'; end if;
end;
$$;

revoke execute on function client_add_task(text, text, date) from public, anon;
revoke execute on function client_set_task_done(uuid, boolean) from public, anon;
grant execute on function client_add_task(text, text, date) to authenticated;
grant execute on function client_set_task_done(uuid, boolean) to authenticated;

-- A client can switch their own morning email off/on (the 0083 guard already limits what a
-- client may change on their own row; daily_digest isn't one of the guarded columns).

-- ============ Comments ============

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index task_comments_task_id_idx on task_comments(task_id, created_at);

alter table task_comments enable row level security;

-- Visibility rides on tasks' own RLS (team rules or the client portal rule above): if you can
-- see the task, you can see and add to its comments.
create policy task_comments_select on task_comments for select
  using (exists (select 1 from tasks t where t.id = task_comments.task_id and t.org_id = task_comments.org_id));

create policy task_comments_insert on task_comments for insert
  with check (
    author_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_comments.task_id and t.org_id = task_comments.org_id)
  );

create policy task_comments_delete on task_comments for delete
  using (author_id = auth.uid());

-- ============ Email throttle log (service role only) ============

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  recipient text not null,
  kind text not null,
  ref_id uuid,
  sent_at timestamptz not null default now()
);
create index notification_log_lookup_idx on notification_log(recipient, kind, ref_id, sent_at desc);
alter table notification_log enable row level security;

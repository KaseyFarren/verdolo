-- Client portal: clients no longer read the tasks table directly.
--
-- tasks_client_select (0091) let a client read whole task rows, including `notes` (and estimates,
-- budget links, assignees) - the portal UI only showed titles/dates, but anyone could query the
-- API for the rest. Now that client tasks are portal-visible by default, a team member's private
-- notes would be exposed. Clients now read tasks only through portal_tasks(), which returns the
-- portal fields and includes notes ONLY on tasks the client added themselves.

-- (The old tasks_client_select policy is dropped in 0097, after the portal code switched over.)

create or replace function portal_task_visible(t tasks)
returns boolean
language sql stable security definer set search_path = public as $$
  select t.client_id is not null
    and t.parent_task_id is null and not t.archived
    and (
      t.client_visible or t.for_client or t.requested_by is not null
      or (t.project_id is not null and exists (
        select 1 from projects p where p.id = t.project_id and p.client_id = t.client_id
      ))
    );
$$;
revoke execute on function portal_task_visible(tasks) from public, anon, authenticated;

create or replace function portal_tasks()
returns table (
  id uuid, title text, done boolean, due_date date, completed_at timestamptz,
  phase_id uuid, project_id uuid, for_client boolean, client_visible boolean,
  requested_by uuid, notes text, skipped boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.done, t.due_date, t.completed_at, t.phase_id, t.project_id,
         t.for_client, t.client_visible, t.requested_by,
         case when t.requested_by is not null and t.requested_by = auth.uid() then t.notes else null end,
         t.skipped, t.created_at
  from tasks t
  where t.client_id = my_client_id()
    and my_client_id() is not null
    and portal_task_visible(t)
  order by t.due_date nulls last
  limit 2000;
$$;
revoke execute on function portal_tasks() from public, anon;
grant execute on function portal_tasks() to authenticated;

-- Comments followed tasks' RLS via a subquery; with no client select policy on tasks that
-- would lock clients out of comments. Use an explicit "can this caller see this task" check
-- covering both sides (team: same rules as tasks_select in 0090; client: portal rule above).
create or replace function can_access_task(target_task_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = target_task_id
      and (
        (is_org_member(t.org_id) and (
          t.assigned_to = auth.uid() or t.assigned_to is null
          or t.assignee_ids @> array[auth.uid()]::uuid[]
          or is_org_admin(t.org_id)
        ))
        or (t.client_id is not null and is_client_user(t.client_id) and portal_task_visible(t))
      )
  );
$$;
revoke execute on function can_access_task(uuid) from public, anon;
grant execute on function can_access_task(uuid) to authenticated;

drop policy if exists task_comments_select on task_comments;
create policy task_comments_select on task_comments for select
  using (can_access_task(task_id));

drop policy if exists task_comments_insert on task_comments;
create policy task_comments_insert on task_comments for insert
  with check (author_id = auth.uid() and can_access_task(task_id));

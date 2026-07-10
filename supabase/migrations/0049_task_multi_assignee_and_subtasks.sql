-- Multi-assignee tasks (assignee_ids array, alongside the existing single assigned_to which
-- stays as the "primary" assignee for pages that haven't been updated to read the array) and
-- single-level subtasks (parent_task_id) with completion gated on all subtasks being done.

-- ============ MULTI-ASSIGNEE ============

alter table tasks add column assignee_ids uuid[] not null default '{}';

-- GIN index for "tasks assigned to me" containment queries (@> array[user_id])
create index tasks_assignee_ids_idx on tasks using gin (assignee_ids);

-- ============ SUBTASKS ============

alter table tasks add column parent_task_id uuid references tasks(id) on delete cascade;
create index tasks_parent_task_id_idx on tasks(parent_task_id);

-- Guard: a subtask must belong to the same org as its parent, and subtasks can't nest more
-- than one level deep (no subtask-of-a-subtask).
create or replace function guard_task_subtask()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_org_id uuid;
  parent_parent_id uuid;
begin
  if new.parent_task_id is not null then
    select org_id, parent_task_id into parent_org_id, parent_parent_id
    from tasks where id = new.parent_task_id;

    if parent_org_id is null then
      raise exception 'parent task not found';
    end if;
    if parent_org_id is distinct from new.org_id then
      raise exception 'subtask must belong to the same org as its parent';
    end if;
    if parent_parent_id is not null then
      raise exception 'subtasks cannot be nested more than one level deep';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_subtask on tasks;
create trigger tasks_guard_subtask before insert or update on tasks
  for each row execute function guard_task_subtask();

-- Guard: a task cannot be marked done while it still has incomplete subtasks. This backstops
-- the app-level UI gate (disabled checkbox) against direct writes.
create or replace function guard_parent_completion()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done then
    if exists (
      select 1 from tasks where parent_task_id = old.id and done = false
    ) then
      raise exception 'cannot complete a task with incomplete subtasks';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_parent_completion on tasks;
create trigger tasks_guard_parent_completion before update on tasks
  for each row execute function guard_parent_completion();

-- ============ RLS: extend assignee-scoped visibility to cover assignee_ids ============

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    assigned_to = auth.uid() or assigned_to is null
    or assignee_ids @> array[auth.uid()]::uuid[]
    or is_org_admin(org_id)
  );

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (
    assigned_to = auth.uid() or assigned_to is null
    or assignee_ids @> array[auth.uid()]::uuid[]
    or is_org_admin(org_id)
  );

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete
  using (
    assigned_to = auth.uid() or assigned_to is null
    or assignee_ids @> array[auth.uid()]::uuid[]
    or is_org_admin(org_id)
  );

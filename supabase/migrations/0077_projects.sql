-- Projects + modular phases: a real container for a body of work, distinct from `budgets`
-- (which is purely a billing construct - fixed fee/retainer/hourly cap, admin-only). A project
-- optionally belongs to a client and optionally links a budget so its header can show burn later.
-- Phases are user-defined, reorderable stages within a project (Discovery/Design/Build/Launch,
-- or whatever the org calls them) - tasks live in a phase and keep every existing task feature.
-- Deleting a project or a phase must never delete tasks: both FKs from tasks are ON DELETE SET
-- NULL, mirroring how tasks.client_id already behaves, so a removed phase/project just orphans
-- its tasks back to the normal Tasks list instead of destroying work.

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  budget_id uuid references budgets(id) on delete set null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  start_date date,
  due_date date,
  sort_order double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_org_idx on projects(org_id, status);
create index projects_client_idx on projects(client_id);

create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();

create table project_phases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_phases_project_idx on project_phases(project_id, sort_order);

create trigger project_phases_set_updated_at before update on project_phases
  for each row execute function set_updated_at();

alter table tasks add column project_id uuid references projects(id) on delete set null;
alter table tasks add column phase_id uuid references project_phases(id) on delete set null;
create index tasks_project_id_idx on tasks(org_id, project_id) where project_id is not null;
create index tasks_phase_id_idx on tasks(phase_id);

-- Guard: a task's phase must belong to the same project as the task, and that project must be
-- in the task's own org. Mirrors guard_task_subtask() (0049) - backstops the app-level "clearing
-- the project clears the phase" UI rule against direct writes.
create or replace function guard_task_phase()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  phase_project_id uuid;
  phase_org_id uuid;
begin
  if new.phase_id is not null then
    select project_id, org_id into phase_project_id, phase_org_id
    from project_phases where id = new.phase_id;

    if phase_project_id is null then
      raise exception 'phase not found';
    end if;
    if phase_org_id is distinct from new.org_id then
      raise exception 'phase must belong to the same org as the task';
    end if;
    if phase_project_id is distinct from new.project_id then
      raise exception 'phase must belong to the task''s project';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_phase on tasks;
create trigger tasks_guard_phase before insert or update on tasks
  for each row execute function guard_task_phase();

alter table projects enable row level security;
alter table project_phases enable row level security;

-- Member-level, not admin-only (unlike budgets) - projects are work organisation everyone on
-- the org needs to see and work, not a financial detail to gate.
create policy projects_all on projects for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- No direct org_id membership check needed beyond the EXISTS - project_phases has no org-crossing
-- risk since project_id is not null and FKs to a project already scoped by is_org_member.
create policy project_phases_all on project_phases for all
  using (exists (select 1 from projects p where p.id = project_id and is_org_member(p.org_id)))
  with check (exists (select 1 from projects p where p.id = project_id and is_org_member(p.org_id)));

alter table projects replica identity full;
alter table project_phases replica identity full;
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table project_phases;

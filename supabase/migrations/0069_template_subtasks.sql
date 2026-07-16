-- Lets default/recurring task templates define a fixed set of subtasks that get created
-- alongside every generated instance (see src/lib/taskGen.ts), mirroring the manual
-- "+ Add subtask" flow from migration 0049 but driven by the template instead of a person.

create table default_task_template_subtasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references default_task_templates(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index default_task_template_subtasks_template_id_idx on default_task_template_subtasks(template_id);
alter table default_task_template_subtasks enable row level security;
create policy default_task_template_subtasks_all on default_task_template_subtasks for all
  using (exists (select 1 from default_task_templates t where t.id = template_id and is_org_member(t.org_id)))
  with check (exists (select 1 from default_task_templates t where t.id = template_id and is_org_member(t.org_id)));

create table recurring_template_subtasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references recurring_templates(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index recurring_template_subtasks_template_id_idx on recurring_template_subtasks(template_id);
alter table recurring_template_subtasks enable row level security;
create policy recurring_template_subtasks_all on recurring_template_subtasks for all
  using (exists (select 1 from recurring_templates t where t.id = template_id and is_org_member(t.org_id)))
  with check (exists (select 1 from recurring_templates t where t.id = template_id and is_org_member(t.org_id)));

-- Identifies which template-subtask definition generated a given tasks row. NULL for
-- manually-added subtasks (the existing "+ Add subtask" flow never sets this), so the unique
-- constraint below - which dedupes generated subtask instances the same way
-- tasks_default_template_instance_unique dedupes generated parent instances - never restricts
-- manual subtasks, since NULLs never conflict in a unique constraint.
alter table tasks add column template_subtask_id uuid;
alter table tasks add constraint tasks_generated_subtask_unique unique (parent_task_id, template_subtask_id);

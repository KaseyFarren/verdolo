-- Generalizes the previously-hardcoded "Daily check-in" auto-task into a configurable
-- list of "default tasks" that fan out to every client, every day (mirrors recurring_templates
-- but always daily and always all-clients — no client_id/frequency needed).

create table default_task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  assigned_to uuid references auth.users(id) on delete set null,
  priority text check (priority in ('High', 'Medium', 'Low')) default 'Medium',
  notes text,
  paused boolean not null default false,
  auto_type text,
  created_at timestamptz not null default now()
);
create index default_task_templates_org_id_idx on default_task_templates(org_id);

alter table default_task_templates enable row level security;
create policy default_task_templates_all on default_task_templates for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table tasks add column if not exists default_template_id uuid references default_task_templates(id) on delete set null;

-- Replaces the old blanket auto_type-only dedupe key: default-task instances now fan out
-- per (client, date, template) instead of one fixed "checkin" auto_type for the whole org.
alter table tasks drop constraint if exists tasks_auto_checkin_unique;
alter table tasks add constraint tasks_default_template_instance_unique unique (org_id, client_id, due_date, default_template_id);

-- Seed the old hardcoded "Daily check-in" as a real, editable/deletable default template per
-- org. auto_type is preserved on the seed row so its generated instances keep updating
-- clients.last_contacted and keep integrating with the Dashboard's AI daily-message send/undo
-- flow, exactly as they did when the checkin generator was hardcoded in taskGen.ts.
insert into default_task_templates (org_id, title, priority, auto_type)
select id, 'Daily check-in', 'High', 'checkin' from orgs;

-- Link any already-generated, not-yet-completed checkin task instances to the new template so
-- pausing/deleting it cleans up pending instances the same way it does for brand-new templates.
update tasks t
set default_template_id = d.id
from default_task_templates d
where t.org_id = d.org_id and d.auto_type = 'checkin' and t.auto_type = 'checkin' and t.is_auto = true and t.default_template_id is null;

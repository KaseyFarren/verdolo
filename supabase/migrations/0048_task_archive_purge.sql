-- Archived tasks are meant to be temporary (see 0033_archive_tasks.sql), not a permanent
-- second copy of every completed task forever. This adds a rollup table so the nightly purge
-- cron (api/cron/archive-cleanup) can hard-delete tasks archived 60+ days ago without zeroing
-- out Revenue's completed/overdue/completed-late counters for old custom date ranges - the
-- same failure mode 0033 fixed for the old "clear completed tasks = hard delete" behavior.
-- Revenue only ever counts archived tasks that are done (archived requires done = true, see
-- DataClient.tsx clearCompleted), so there's no "overdue incomplete" bucket to preserve here.
create table task_archived_totals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  original_due_date date not null,
  completed integer not null default 0,
  completed_late integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, assigned_to, original_due_date)
);

create index task_archived_totals_org_idx on task_archived_totals (org_id, original_due_date);

alter table task_archived_totals enable row level security;

-- Read-only from the app's perspective - the purge cron writes via the admin client, which
-- bypasses RLS entirely, same as time_archived_totals's insert/update split.
create policy task_archived_totals_select on task_archived_totals for select
  using (is_org_member(org_id));

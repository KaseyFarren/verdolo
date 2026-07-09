-- "Clear completed tasks" used to hard-delete done tasks, which silently zeroed out
-- historical task-completion counts on Revenue and Reports (both query the tasks table
-- directly, scoped by date). Archiving instead of deleting keeps the rows for that history
-- while still hiding them from the day-to-day Tasks/Dashboard views.
alter table tasks add column archived boolean not null default false;
alter table tasks add column archived_at timestamptz;

create index idx_tasks_archived on tasks (org_id, archived) where archived = true;

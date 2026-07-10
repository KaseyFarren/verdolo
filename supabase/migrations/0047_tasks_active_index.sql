-- The everyday tasks query (Tasks page, Dashboard) filters archived = false, ordered by
-- due_date - but 0033_archive_tasks.sql only indexed the rare archived = true case. This
-- covers the common query shape instead.
create index idx_tasks_active on tasks(org_id, archived, due_date) where archived = false;

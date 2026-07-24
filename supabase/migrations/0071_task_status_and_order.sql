-- Kanban board support: a real workflow status (independent of the `done` boolean, which stays
-- as the source of truth for completion elsewhere in the app) and a fractional sort position so
-- cards can be reordered/inserted within a column without renumbering siblings.

alter table tasks add column status text not null default 'todo'
  check (status in ('todo', 'in_progress', 'in_review', 'done'));

alter table tasks add column sort_order double precision not null default 0;

update tasks set status = 'done' where done = true;

create index tasks_status_idx on tasks(org_id, status);

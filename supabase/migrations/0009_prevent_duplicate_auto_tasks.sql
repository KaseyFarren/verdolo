-- Dedupe existing duplicates first (unique constraints below will fail otherwise).
-- Keep the most "complete" row per group: done, then most recently completed, then oldest.
with ranked_checkin as (
  select id, row_number() over (
    partition by org_id, client_id, due_date, auto_type
    order by done desc, completed_at desc nulls last, created_at asc
  ) as rn
  from tasks
  where is_auto = true and auto_type is not null
)
delete from tasks where id in (select id from ranked_checkin where rn > 1);

with ranked_recurring as (
  select id, row_number() over (
    partition by org_id, recurring_id, due_date
    order by done desc, completed_at desc nulls last, created_at asc
  ) as rn
  from tasks
  where recurring_id is not null
)
delete from tasks where id in (select id from ranked_recurring where rn > 1);

-- NULLs never conflict in a unique constraint, so this only constrains rows that
-- actually have auto_type/recurring_id set — regular manually-created tasks are unaffected.
alter table tasks add constraint tasks_auto_checkin_unique unique (org_id, client_id, due_date, auto_type);
alter table tasks add constraint tasks_recurring_instance_unique unique (org_id, recurring_id, due_date);

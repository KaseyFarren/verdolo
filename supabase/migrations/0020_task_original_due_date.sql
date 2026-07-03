-- Freezes each task's original due date so "overdue" / "completed late" metrics can't be
-- gamed by an assignee pushing due_date forward before it lapses. due_date stays freely
-- editable for real rescheduling; original_due_date is set once and never changes again.
alter table tasks add column original_due_date date;
update tasks set original_due_date = due_date where original_due_date is null;

create or replace function freeze_original_due_date()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.original_due_date := new.due_date;
  elsif tg_op = 'UPDATE' then
    new.original_due_date := old.original_due_date;
  end if;
  return new;
end;
$$;

create trigger tasks_freeze_original_due_date
  before insert or update on tasks
  for each row execute function freeze_original_due_date();

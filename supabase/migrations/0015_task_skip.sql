-- Distinct "skip" for a recurring/auto task occurrence, separate from "snooze" (push +1 day).
-- Skipping keeps the row in place (done=true) so the recurring-instance upsert's unique
-- constraint stops it from being regenerated for that date, but is flagged separately so it's
-- filtered out of both the pending list and the "Completed" section (it wasn't actually done).
alter table tasks add column if not exists skipped boolean not null default false;

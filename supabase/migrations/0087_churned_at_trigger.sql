-- churned_at (0086) was only being set by one specific button in the Clients UI (Pause/Activate).
-- Editing a client's stage to 'Churned' any other way (e.g. the pipeline-stage picker in the
-- Edit modal) left churned_at null, which Reports/Revenue read as "still active" - silently
-- disagreeing with Dashboard's stage-based MRR figure for the same client. Enforcing this at the
-- database layer means every write path (present or future) keeps the two in sync automatically,
-- instead of every call site having to remember to set churned_at itself.
create or replace function sync_client_churned_at()
returns trigger
language plpgsql as $$
begin
  if new.stage = 'Churned' and (old.stage is distinct from 'Churned') and new.churned_at is null then
    new.churned_at := current_date;
  elsif new.stage is distinct from 'Churned' and old.stage = 'Churned' then
    new.churned_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_sync_churned_at on clients;
create trigger clients_sync_churned_at before update on clients
  for each row execute function sync_client_churned_at();

-- One-time backfill for any client already Churned before this migration, so it doesn't start
-- out disagreeing with its own stage the moment the trigger above goes live.
update clients set churned_at = current_date where stage = 'Churned' and churned_at is null;

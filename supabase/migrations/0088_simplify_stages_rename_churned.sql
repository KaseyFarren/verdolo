-- Simplifies the client pipeline from 5 manually-set stages to 3 (Lead, Active, Paused).
-- 'Trial' and 'At Risk' overlapped with signals the app already computes automatically
-- (health status from contact recency - see getHealthScore), and full deletion is now the
-- real "this client is gone" action, so 'Churned' becomes 'Paused' - a lighter, reversible
-- "not currently billing" marker (matches the existing Pause/Activate button), not an
-- end-of-pipeline stage. Also drops the word "churn" from the schema per explicit request.

-- Drop the old constraint before touching the data, so the transitional values (rows still
-- saying 'Trial'/'At Risk'/'Churned') aren't rejected mid-migration.
alter table clients drop constraint clients_stage_check;

-- Fold any existing Trial/At Risk clients back to Active (there is no direct equivalent -
-- these were manual states, not automatically derived from other columns).
update clients set stage = 'Active' where stage in ('Trial', 'At Risk');
update clients set stage = 'Paused' where stage = 'Churned';

alter table clients add constraint clients_stage_check check (stage in ('Lead', 'Active', 'Paused'));

alter table clients rename column churned_at to paused_at;

drop trigger if exists clients_sync_churned_at on clients;
drop function if exists sync_client_churned_at();

create or replace function sync_client_paused_at()
returns trigger
language plpgsql as $$
begin
  if new.stage = 'Paused' and (old.stage is distinct from 'Paused') and new.paused_at is null then
    new.paused_at := current_date;
  elsif new.stage is distinct from 'Paused' and old.stage = 'Paused' then
    new.paused_at := null;
  end if;
  return new;
end;
$$;

create trigger clients_sync_paused_at before update on clients
  for each row execute function sync_client_paused_at();

update client_health_snapshots set health = 'paused' where health = 'churned';
alter table client_health_snapshots drop constraint client_health_snapshots_health_check;
alter table client_health_snapshots add constraint client_health_snapshots_health_check check (health in ('green', 'amber', 'red', 'paused'));

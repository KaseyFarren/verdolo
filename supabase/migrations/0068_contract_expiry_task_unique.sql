-- Dedupe key for auto-generated "contract expiring" tasks (see api/cron/contract-expiry-tasks).
-- due_date is set to the contract's actual contract_ends date, so this only blocks re-creating
-- the same expiry-cycle task on every daily cron run - if the contract is later renewed to a new
-- contract_ends, that's a new due_date and a fresh task is created for the new cycle.
-- auto_type is part of the key (not a partial-index predicate) because PostgREST upsert's
-- onConflict can't target a partial index - existing 'checkin' rows are unaffected since they
-- carry a different auto_type and are deduped separately via tasks_default_template_instance_unique.
alter table tasks add constraint tasks_contract_expiry_unique unique (org_id, client_id, due_date, auto_type);

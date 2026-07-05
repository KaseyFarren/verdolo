-- Batch of pre-sale features that need no third-party integrations: recurring retainer
-- billing, client health trend, and a proposals/contracts tracker (schema for the last one
-- already existed from 0001_init.sql as dead schema, same pattern as invoices before Phase 1).

-- Recurring retainer billing (Phase 2) — tag which invoices were auto-generated vs manually
-- created, so the monthly cron can check "have we already billed this client this month"
-- without depending on Stripe metadata, and so the UI can label them.
alter table invoices add column if not exists source text not null default 'manual' check (source in ('manual', 'recurring'));

-- Client health trend — a daily snapshot of the live health-score computation
-- (src/lib/agency.ts getHealthScore), so we can chart it over time. No historical
-- backfill is possible; trend data starts accumulating from whenever the cron first runs.
create table client_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  snapshot_date date not null default current_date,
  health text not null check (health in ('green', 'amber', 'red', 'churned')),
  created_at timestamptz not null default now(),
  unique (client_id, snapshot_date)
);
create index client_health_snapshots_client_id_idx on client_health_snapshots(client_id, snapshot_date);

alter table client_health_snapshots enable row level security;
create policy client_health_snapshots_select on client_health_snapshots for select using (is_org_member(org_id));

-- Proposals/contracts tracker — the table + RLS already exist (0001_init.sql) but were never
-- used by any code; extend with the fields the tracker actually needs.
alter table proposals add column if not exists title text not null default 'Untitled proposal';
alter table proposals add column if not exists amount_cents integer not null default 0;
alter table proposals add column if not exists notes text;

-- 0001_init.sql's proposals_write ("for all using is_org_member") let any member write —
-- never exercised by real code until now. Tighten to admin+owner, matching the precedent set
-- for clients (0010_owner_role.sql): members see proposals but don't create/edit them.
drop policy if exists proposals_write on proposals;
create policy proposals_write on proposals for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

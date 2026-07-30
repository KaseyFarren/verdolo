-- Lightweight per-client budgets (V2 Phase 1, item 2): a fixed-fee, retainer, or hourly-cap
-- engagement to track spend/hours against, separate from the client-level monthly retainer
-- burn already tracked by retainer_hours/computeClientBurn (0072). Deliberately no phases,
-- Gantt, or dependencies - see VERDOLO_V2_STRATEGY.md.

create table budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  type text not null check (type in ('fixed_fee', 'retainer', 'hourly_cap')),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  hours_cap numeric check (hours_cap is null or hours_cap > 0),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_has_a_cap check (amount_cents is not null or hours_cap is not null),
  constraint budgets_end_after_start check (end_date is null or end_date >= start_date)
);
create index budgets_org_id_idx on budgets(org_id);
create index budgets_client_id_idx on budgets(client_id);

alter table tasks add column budget_id uuid references budgets(id) on delete set null;
alter table time_entries add column budget_id uuid references budgets(id) on delete set null;
create index tasks_budget_id_idx on tasks(budget_id);
create index time_entries_budget_id_idx on time_entries(budget_id);

alter table budgets enable row level security;

-- Admin-only, unlike clients (is_org_member) - members have a legitimate reason to browse
-- clients for non-financial fields, but budgets exist purely to expose amount_cents/hours_cap,
-- so there's no case for a view-only member to read this table at all.
create policy budgets_select on budgets for select using (is_org_admin(org_id));
create policy budgets_insert on budgets for insert with check (is_org_admin(org_id));
create policy budgets_update on budgets for update using (is_org_admin(org_id));
create policy budgets_delete on budgets for delete using (is_org_admin(org_id));

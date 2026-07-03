-- Ad-hoc billable amounts on top of a client's fixed monthly retainer (e.g. one-off project
-- work, extra ad spend management fee), so the Revenue page can attribute a client's *actual*
-- monthly revenue (retainer + charges), not just the flat retainer figure.
create table client_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  description text not null,
  amount_cents integer not null,
  charged_on date not null,
  created_at timestamptz not null default now()
);
create index client_charges_org_id_idx on client_charges(org_id);
create index client_charges_client_id_idx on client_charges(client_id);

alter table client_charges enable row level security;

-- revenue is owner-only, same as invoices
create policy client_charges_all on client_charges for all
  using (is_org_owner(org_id)) with check (is_org_owner(org_id));

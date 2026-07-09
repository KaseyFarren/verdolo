-- Hourly billing as an alternative to flat monthly retainer. A client is billed one way or
-- the other, never both - billing_mode is the discriminator every downstream computation
-- (Revenue, Reports, the recurring cron, manual invoicing, MRR) branches on.
alter table clients add column if not exists billing_mode text not null default 'retainer'
  check (billing_mode in ('retainer', 'hourly'));
alter table clients add column if not exists hourly_rate_cents integer default 0;

-- Defense in depth for mrrCentsTotal() (src/lib/agency.ts), which sums retainer_cents across
-- all non-Churned/non-Lead clients as "committed monthly revenue" - hourly clients must never
-- carry a stray nonzero retainer_cents (e.g. left over from before they switched modes), or
-- they'd silently inflate MRR with revenue that isn't fixed/recurring. The app also zeroes
-- retainer_cents whenever a client is saved as hourly; this constraint makes that invariant
-- unbreakable at the data layer too.
alter table clients add constraint clients_hourly_retainer_zero
  check (billing_mode <> 'hourly' or retainer_cents = 0);

-- Ties a time_entries row to the invoice it was billed on, exactly like
-- client_charges.invoice_id (0026_client_invoicing.sql) - an already-invoiced entry isn't
-- offered again as "unbilled" next time the cron or a manual invoice runs.
alter table time_entries add column if not exists invoice_id uuid references invoices(id) on delete set null;

-- Speeds "this client's unbilled billable hours" lookups (recurring cron, manual invoice
-- line-item seeding, and the Time page's archive-sweep guard).
create index if not exists idx_time_entries_unbilled on time_entries (org_id, client_id)
  where invoice_id is null and billable = true;

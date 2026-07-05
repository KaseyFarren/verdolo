-- Real client invoicing via Stripe Connect (Standard accounts). Agencies bill their own
-- clients and collect payment through Verdolo instead of a manual revenue ledger.

alter table orgs add column if not exists stripe_connect_status text not null default 'not_connected'
  check (stripe_connect_status in ('not_connected', 'pending', 'active'));

alter table clients add column if not exists stripe_customer_id text;

alter table invoices add column if not exists line_items jsonb not null default '[]';
alter table invoices add column if not exists stripe_hosted_invoice_url text;
alter table invoices add column if not exists stripe_pdf_url text;
alter table invoices add column if not exists sent_at timestamptz;
alter table invoices add column if not exists paid_at timestamptz;

-- Ties a client_charges row to the invoice it was billed on, so an already-invoiced charge
-- isn't offered again as an unbilled line item next time.
alter table client_charges add column if not exists invoice_id uuid references invoices(id) on delete set null;

-- RLS already covers this table (0001_init.sql: invoices_select for org members,
-- invoices_write admin+owner) — matches the intended permission model exactly, nothing to add.

create index if not exists invoices_stripe_invoice_id_idx on invoices(stripe_invoice_id);

-- Client invoicing via Stripe Connect (0026_client_invoicing.sql) was fully removed at the
-- app layer in commit 187dcd9, and the last app-side readers of `invoices` (Reports, Dashboard,
-- scope-creep-note - see monthPaidInvoices removal) were just deleted too. Nothing anywhere
-- creates, updates, or reads a row in `invoices` any more, so the table and its Connect-only
-- columns elsewhere are pure dead schema.
--
-- client_charges.invoice_id is unused by any code (only time_entries.invoice_id is still read,
-- by TimeClient's clear-old-entries safety check, to protect not-yet-invoiced billable hourly
-- work from being archived) so it's dropped outright. time_entries.invoice_id is kept - CASCADE
-- below only drops its now-dangling FK to `invoices`, not the column itself; it stays a
-- permanently-null marker, which matches its actual behavior today since nothing has set it
-- since invoicing was removed.
alter table client_charges drop column if exists invoice_id;

drop table if exists invoices cascade;

alter table clients drop column if exists stripe_customer_id;
alter table orgs drop column if exists stripe_connect_status;

-- Next-bill date for the admin org list, so it can show it without a live Stripe call
-- per row at hundreds-of-orgs scale. Populated only by the billing webhook (service-role
-- write), same as the other Stripe-sync columns from 0013_billing.sql - no RLS change needed.
alter table orgs add column if not exists current_period_end timestamptz;

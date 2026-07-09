-- Per-seat subscription billing: 14-day free trial starting at org creation, then requires an
-- active Stripe subscription. seats_purchased caps active org_members and is only ever written
-- by server-side code (create_org RPC, Stripe webhook handler, /api/billing/seats) using the
-- service-role client or a security-definer function - never by a direct client-side update -
-- so no RLS change is needed on `orgs` for these columns.

alter table orgs add column if not exists stripe_customer_id text;
alter table orgs add column if not exists stripe_subscription_id text;
alter table orgs add column if not exists subscription_status text
  check (subscription_status in ('trialing', 'active', 'past_due', 'canceled'));
alter table orgs add column if not exists trial_ends_at timestamptz;
alter table orgs add column if not exists seats_purchased integer not null default 1;

create index if not exists orgs_stripe_customer_id_idx on orgs(stripe_customer_id);
create index if not exists orgs_stripe_subscription_id_idx on orgs(stripe_subscription_id);

create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name, subscription_status, trial_ends_at, seats_purchased)
  values (org_name, 'trialing', now() + interval '14 days', 1)
  returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());
  return new_org_id;
end;
$$;

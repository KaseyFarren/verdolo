-- 0040_messaging.sql redefined create_org() to insert the new team message_thread, but its
-- `insert into orgs (name) values (org_name)` reverted to the pre-0013 shape and dropped the
-- trial defaults 0013_billing.sql had added (subscription_status='trialing', trial_ends_at =
-- now()+14 days). Every self-signup since then got subscription_status/trial_ends_at = null,
-- which hasActiveAccess() (src/lib/org.ts) treats as no access - new signups were paywalled to
-- Settings > Billing immediately, with no trial at all.

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
  insert into message_threads (org_id, kind) values (new_org_id, 'team');
  return new_org_id;
end;
$$;

-- Repair orgs created while the regression was live (2026-07-09 through now) that never got a
-- subscription_status and have no real Stripe subscription - give them a fresh 14-day trial
-- starting now rather than backdating to their (arbitrary, bug-affected) created_at.
update orgs
set subscription_status = 'trialing', trial_ends_at = now() + interval '14 days'
where subscription_status is null and stripe_subscription_id is null;

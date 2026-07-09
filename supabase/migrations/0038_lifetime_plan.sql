-- A lifetime org pays a one-time fee instead of a recurring base subscription. It's otherwise a
-- normal org: subscription_status stays 'active' permanently (reusing the existing "not blocked"
-- meaning - no seat-gating code needs to change) and stripe_subscription_id stays null unless the
-- owner later buys extra seats beyond the 2 included in the one-time purchase.

alter table orgs add column if not exists plan_type text not null default 'subscription'
  check (plan_type in ('subscription', 'lifetime'));

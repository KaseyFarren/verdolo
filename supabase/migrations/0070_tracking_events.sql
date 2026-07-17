-- Internal event log for marketing/product analytics (trial starts, purchases, upgrades,
-- CTA clicks), independent of Meta Pixel/CAPI. Written exclusively via the service-role
-- client in src/lib/tracking/meta.ts (and cross-origin from verdolo-site through
-- /api/track), so RLS stays default-deny with no policies - never queried from client code.
create table tracking_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_id text not null,
  pixel text not null,
  source text not null,
  org_id uuid references orgs(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- event_id is unique per logical event (e.g. "purchase-<checkout_session_id>") so retried
-- webhooks and duplicate client fires can be inserted idempotently (see the ON CONFLICT
-- DO NOTHING in trackEvent()) instead of double-counting a conversion.
create unique index tracking_events_event_id_unique on tracking_events(event_id);
create index tracking_events_event_name_idx on tracking_events(event_name);
create index tracking_events_org_id_idx on tracking_events(org_id);
alter table tracking_events enable row level security;

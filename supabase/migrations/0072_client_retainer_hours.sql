-- Optional explicit hours-included figure for a retainer client, used by burn tracking
-- (src/lib/burn.ts) as the numerator's budget instead of deriving it from
-- retainer_cents / org.settings.hourly_cost_cents. Nullable - most clients never set this
-- and burn tracking falls back to the derived figure automatically.
alter table clients add column retainer_hours numeric
  check (retainer_hours is null or retainer_hours > 0);

-- Mirrors clients_hourly_retainer_zero (0034_hourly_billing.sql): an hourly client has no
-- retainer concept at all, so it must not carry a stray included-hours figure either.
alter table clients add constraint clients_hourly_no_retainer_hours
  check (billing_mode <> 'hourly' or retainer_hours is null);

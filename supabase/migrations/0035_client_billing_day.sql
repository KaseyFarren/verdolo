-- Day of the month a client's retainer renews on. Defaults to 1 so existing clients keep
-- today's behavior (proration assumes a calendar-month cycle) unless explicitly edited.
-- Capped at 28 so every calendar month contains the day - no clamping needed for short months.
alter table clients add column if not exists billing_day integer not null default 1
  check (billing_day between 1 and 28);

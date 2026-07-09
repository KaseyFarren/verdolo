-- Widen billing_day to allow 29-31. App code (billingCycleElapsedFraction in src/lib/period.ts)
-- now clamps to the last real day of any given month, matching how real billing systems handle
-- a day-31 subscriber in a 30-day month (bills on the 30th, not next month) - so this no longer
-- needs to be capped at 28 to sidestep short-month/leap-year edge cases.
alter table clients drop constraint clients_billing_day_check;
alter table clients add constraint clients_billing_day_check check (billing_day between 1 and 31);

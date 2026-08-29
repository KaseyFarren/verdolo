-- Clients previously had no record of *when* they churned - only the current stage/status,
-- which is a snapshot, not history. That made it impossible to both (a) keep a churned client's
-- real historical retainer revenue intact for past months, and (b) stop counting them as billing
-- once they actually left, without a lossy workaround (zeroing retainer_cents outright, which
-- also erases their pre-churn revenue). churned_at gives revenue/profitability calculations an
-- exact cutoff instead.
alter table clients add column churned_at date;

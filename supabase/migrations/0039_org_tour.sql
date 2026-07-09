-- One-time guided product tour, triggered once per org (not per user/localStorage) so a teammate
-- invited after the owner has already set the agency up doesn't see it again.

alter table orgs add column if not exists onboarding_tour_completed_at timestamptz;

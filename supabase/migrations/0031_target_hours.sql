-- Per-teammate weekly capacity target, used by Reports -> Capacity to judge hours logged
-- against a baseline (previously there was no way to tell "busy" from "overloaded", only
-- relative rank against teammates). Nullable with no default: a member with no target set
-- must be indistinguishable from before this column existed.
alter table org_members add column if not exists target_hours_per_week integer;

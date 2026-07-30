-- Task time estimates (V2 Phase 1, item 3): one column, deliberately no rollups or capacity
-- view yet - this just captures the number so budget forecasting and the Phase 3 capacity view
-- have real data to read later. See VERDOLO_V2_STRATEGY.md.

alter table tasks add column estimated_hours numeric check (estimated_hours is null or estimated_hours > 0);

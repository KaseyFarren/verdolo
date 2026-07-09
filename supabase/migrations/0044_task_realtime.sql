-- Enables realtime on tasks (for the new mention/assignment notification sound) and full
-- replica identity so UPDATE events carry the old row too - needed to detect "assigned_to
-- just changed to me" rather than every unrelated task update.

alter table tasks replica identity full;
alter publication supabase_realtime add table tasks;

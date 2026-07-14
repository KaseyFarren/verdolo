-- Enables realtime on proposals, time_entries, and client_charges so the Proposals and Revenue
-- pages live-sync across teammates/sessions without a manual refresh, same pattern as
-- tasks (0044) and clients (0055/0056). Replica identity full is required on all three - the
-- org_id=eq.X DELETE filter needs org_id present in the deleted row's WAL image, which the
-- default replica identity (primary key only) doesn't carry.

alter table proposals replica identity full;
alter publication supabase_realtime add table proposals;

alter table time_entries replica identity full;
alter publication supabase_realtime add table time_entries;

alter table client_charges replica identity full;
alter publication supabase_realtime add table client_charges;

-- Enables realtime on clients (live-sync the Clients list/detail, same as tasks) and on
-- message_thread_participants (so a brand-new DM thread someone else starts with you shows up
-- in the sidebar without a reload - previously only messages/reactions synced live, not thread
-- creation itself).

alter publication supabase_realtime add table clients;
alter publication supabase_realtime add table message_thread_participants;

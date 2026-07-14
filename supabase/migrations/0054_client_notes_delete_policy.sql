-- client_notes has had select+insert RLS since 0001_init.sql but no delete policy, so the
-- delete button in ClientsClient.tsx (and the bulk "clear org data" path in
-- settings/DataClient.tsx) has always silently failed for every role, including owner -
-- optimistic UI removes the row, the real delete is rejected, then it rolls back with an
-- error toast. The delete button in the UI is unconditional (any org member can delete any
-- note, not just their own), matching the existing insert policy scope, so mirror that here.
create policy client_notes_delete on client_notes for delete using (is_org_member(org_id));

-- Realtime DELETE filters (org_id=eq.X) need the filtered column present in the deleted row's
-- WAL image, but the default replica identity only carries the primary key - so the DELETE
-- listener added in 0055 silently never matched and clients never disappeared live for other
-- viewers. Same fix already applied to tasks in 0044.

alter table clients replica identity full;

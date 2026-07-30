-- messages_body_or_attachment_check (0041) rejects a row with both body='' and attachment_path
-- null - exactly what soft-delete (0075) writes, so every delete was silently failing at the DB
-- layer. Allow the empty/empty combination once deleted_at is set.

alter table messages drop constraint if exists messages_body_or_attachment_check;

alter table messages add constraint messages_body_or_attachment_check
  check (coalesce(length(trim(body)), 0) > 0 or attachment_path is not null or deleted_at is not null);

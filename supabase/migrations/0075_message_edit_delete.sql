-- Edit + soft-delete for messages. Delete is soft (deleted_at set, body/attachment cleared)
-- rather than a hard DELETE so reply threads and reaction counts on other messages stay intact
-- and the UI can show a Slack-style "message deleted" placeholder instead of a gap.

alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists deleted_at timestamptz;

-- Only the sender may update their own message, and only the mutable fields (body, edited_at,
-- deleted_at, attachment_*) - the trigger below pins every other column to its prior value so
-- an update can't be used to move a message to a different thread, reassign its sender, forge
-- its timestamp, or add mentions that were never validated against the original insert.
create policy messages_update on messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create or replace function messages_before_update()
returns trigger
language plpgsql as $$
begin
  new.thread_id := old.thread_id;
  new.org_id := old.org_id;
  new.sender_id := old.sender_id;
  new.created_at := old.created_at;
  new.parent_message_id := old.parent_message_id;
  new.reply_count := old.reply_count;
  new.last_reply_at := old.last_reply_at;
  new.mentioned_user_ids := old.mentioned_user_ids;
  return new;
end;
$$;

drop trigger if exists trg_messages_before_update on messages;
create trigger trg_messages_before_update before update on messages
  for each row execute function messages_before_update();

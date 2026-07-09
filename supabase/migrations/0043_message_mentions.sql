-- @mentions on messages - stored as an array of mentioned user ids (set client-side from the
-- compose autocomplete, not parsed server-side) so the sidebar can flag "you were mentioned"
-- distinctly from a plain unread message.

alter table messages add column mentioned_user_ids uuid[] not null default '{}';

-- GIN index for "messages that mention me" containment queries (@> array[user_id])
create index messages_mentioned_user_ids_idx on messages using gin (mentioned_user_ids);

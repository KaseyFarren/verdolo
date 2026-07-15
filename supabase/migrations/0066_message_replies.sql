-- Threaded replies: a message with parent_message_id set is a reply, kept out of the main
-- channel body and shown only in the parent's thread panel. reply_count/last_reply_at are
-- denormalized onto the parent (same pattern as message_threads.last_message_at in 0046) so
-- the "N replies" indicator doesn't need a count(*) query per row.

alter table messages add column if not exists parent_message_id uuid references messages(id) on delete cascade;
alter table messages add column if not exists reply_count int not null default 0;
alter table messages add column if not exists last_reply_at timestamptz;
create index if not exists messages_parent_id_idx on messages(parent_message_id) where parent_message_id is not null;

create or replace function messages_after_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update message_threads
    set last_message_at = new.created_at,
        last_message_preview = left(new.body, 140)
    where id = new.thread_id;

  if new.mentioned_user_ids is not null and array_length(new.mentioned_user_ids, 1) > 0 then
    insert into message_mentions (message_id, thread_id, user_id, org_id, created_at)
    select new.id, new.thread_id, u, new.org_id, new.created_at
    from unnest(new.mentioned_user_ids) as u
    where exists (select 1 from auth.users where id = u);
  end if;

  if new.parent_message_id is not null then
    update messages
      set reply_count = reply_count + 1,
          last_reply_at = new.created_at
      where id = new.parent_message_id;
  end if;

  return new;
end;
$$;

-- backfill reply_count/last_reply_at for any pre-existing replies (none expected pre-launch,
-- but safe to re-run)
update messages p
  set reply_count = r.count,
      last_reply_at = r.max_created_at
  from (
    select parent_message_id, count(*) as count, max(created_at) as max_created_at
    from messages
    where parent_message_id is not null
    group by parent_message_id
  ) r
  where p.id = r.parent_message_id;

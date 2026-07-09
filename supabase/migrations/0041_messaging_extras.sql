-- Messaging extras: read/unread tracking, emoji reactions, and file attachments.

-- ============ READ TRACKING ============
-- one row per (thread, user) - last_read_at drives the unread badge in the sidebar. Only
-- the user themselves can see/update their own row (no "seen by" receipts requested).

create table message_reads (
  thread_id uuid not null references message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table message_reads enable row level security;

create policy message_reads_select on message_reads for select using (user_id = auth.uid());
create policy message_reads_insert on message_reads for insert
  with check (user_id = auth.uid() and can_access_thread(thread_id));
create policy message_reads_update on message_reads for update using (user_id = auth.uid());

-- ============ EMOJI REACTIONS ============
-- thread_id/org_id are denormalized from messages so RLS and the realtime filter can key
-- off them directly without a join.

create table message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  thread_id uuid not null references message_threads(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index message_reactions_message_id_idx on message_reactions(message_id);

-- DELETE realtime events only carry primary-key columns by default; full replica identity
-- puts org_id/thread_id/message_id in payload.old too, so the client can filter by org_id
-- and remove the right reaction from the right message's cache.
alter table message_reactions replica identity full;

-- thread_id/org_id are client-supplied for convenience, but trusting them as-is would let a
-- member spoof a thread_id they DO have access to while reacting to a message_id that
-- actually belongs to a thread they don't - the RLS check below would pass against the fake
-- thread_id. Overwrite both from the message's real row before RLS evaluates the new row.
create or replace function set_message_reaction_context()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select thread_id, org_id into new.thread_id, new.org_id from messages where id = new.message_id;
  return new;
end;
$$;

create trigger message_reactions_set_context before insert on message_reactions
  for each row execute function set_message_reaction_context();

alter table message_reactions enable row level security;

create policy message_reactions_select on message_reactions for select using (can_access_thread(thread_id));
create policy message_reactions_insert on message_reactions for insert
  with check (user_id = auth.uid() and can_access_thread(thread_id));
create policy message_reactions_delete on message_reactions for delete using (user_id = auth.uid());

alter publication supabase_realtime add table message_reactions;

-- ============ FILE ATTACHMENTS ============

alter table messages add column attachment_path text;
alter table messages add column attachment_name text;
alter table messages add column attachment_type text;
alter table messages add column attachment_size_bytes bigint;

alter table messages drop constraint if exists messages_body_or_attachment_check;
alter table messages alter column body drop not null;
alter table messages add constraint messages_body_or_attachment_check
  check (coalesce(length(trim(body)), 0) > 0 or attachment_path is not null);

-- private bucket (messages may contain client-sensitive material) - path convention:
-- {thread_id}/{timestamp}-{filename}, matching can_access_thread's thread-scoped check
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

create policy message_attachments_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and can_access_thread((storage.foldername(name))[1]::uuid));

create policy message_attachments_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'message-attachments' and can_access_thread((storage.foldername(name))[1]::uuid));

create policy message_attachments_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'message-attachments' and can_access_thread((storage.foldername(name))[1]::uuid));

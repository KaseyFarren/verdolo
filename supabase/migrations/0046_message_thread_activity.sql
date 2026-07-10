-- Sidebar "last message"/"last mention per thread" used to be computed by scanning every
-- message in every thread the user belongs to (order by created_at desc, take first per
-- thread_id in JS). That scales with total lifetime message count, not thread count, so a
-- busy team channel gets slower to load forever. Denormalize last-activity onto the thread
-- row (trigger-maintained) and track mentions in a small per-user table instead.
--
-- Written to be safe to re-run (e.g. after a partial failure): guards every create with
-- if-not-exists / drop-if-exists, and backfills only mentions whose user still exists (old
-- messages can reference an org member who has since been deleted from auth.users).

alter table message_threads add column if not exists last_message_at timestamptz;
alter table message_threads add column if not exists last_message_preview text;

create table if not exists message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  thread_id uuid not null references message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null
);
create index if not exists message_mentions_user_thread_idx on message_mentions(user_id, thread_id, created_at desc);

alter table message_mentions enable row level security;

drop policy if exists message_mentions_select on message_mentions;
create policy message_mentions_select on message_mentions for select
  using (user_id = auth.uid() and can_access_thread(thread_id));

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

  return new;
end;
$$;

drop trigger if exists trg_messages_after_insert on messages;
create trigger trg_messages_after_insert after insert on messages
  for each row execute function messages_after_insert();

-- backfill existing data so the new columns/table reflect history that predates this migration
update message_threads t
  set last_message_at = m.max_created_at,
      last_message_preview = m.preview
  from (
    select distinct on (thread_id) thread_id, created_at as max_created_at, left(body, 140) as preview
    from messages
    order by thread_id, created_at desc
  ) m
  where t.id = m.thread_id;

insert into message_mentions (message_id, thread_id, user_id, org_id, created_at)
select m.id, m.thread_id, u, m.org_id, m.created_at
from messages m, unnest(m.mentioned_user_ids) as u
where m.mentioned_user_ids is not null
  and array_length(m.mentioned_user_ids, 1) > 0
  and exists (select 1 from auth.users where id = u)
  and not exists (select 1 from message_mentions mm where mm.message_id = m.id and mm.user_id = u);

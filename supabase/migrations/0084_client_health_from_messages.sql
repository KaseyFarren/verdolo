-- Ties the client portal message thread into the existing health-score signals
-- (clients.last_contacted / clients.awaiting_reply, see getHealthScore in src/lib/agency.ts).
-- Until now those two columns only moved via manual Dashboard actions (markSent /
-- setAwaitingReply) - a live back-and-forth in the client's message channel didn't count
-- as contact at all, so an org could be actively chatting with a client all week and still
-- show them as "Overdue".
--
-- Reuses the existing trg_messages_after_insert trigger (0046) rather than adding a second
-- trigger on the same table. Only fires for kind='client' threads; team channel and DM
-- threads have no client_id and are left untouched.
--
-- Direction sets awaiting_reply the same way the manual controls already do (true = team is
-- waiting on the client): an org member sending in the channel is an outreach, exactly like
-- markSent(); a client_user sending is them responding (or reaching out first), which clears
-- it either way - there's no separate "team owes them one" state today, and adding one is out
-- of scope here.
create or replace function messages_after_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_client_id uuid;
  sender_is_client boolean;
begin
  update message_threads
    set last_message_at = new.created_at,
        last_message_preview = left(new.body, 140)
    where id = new.thread_id
    returning client_id into target_client_id;

  if target_client_id is not null then
    sender_is_client := exists (
      select 1 from client_users
      where client_id = target_client_id and user_id = new.sender_id and status = 'active'
    );
    update clients
      set last_contacted = current_date,
          awaiting_reply = not sender_is_client
      where id = target_client_id;
  end if;

  if new.mentioned_user_ids is not null and array_length(new.mentioned_user_ids, 1) > 0 then
    insert into message_mentions (message_id, thread_id, user_id, org_id, created_at)
    select new.id, new.thread_id, u, new.org_id, new.created_at
    from unnest(new.mentioned_user_ids) as u
    where exists (select 1 from auth.users where id = u);
  end if;

  return new;
end;
$$;

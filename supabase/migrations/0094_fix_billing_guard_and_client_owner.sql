-- Fixes to 0091/0093, found by re-running the audit probes on prod:
-- 1. guard_org_billing_columns() was security definer, so current_user inside it was always the
--    function owner and the guard never fired. As security invoker it sees `authenticated` for
--    browser writes; trusted paths (security definer RPCs, service role) still get through.
-- 2. client_add_task() looked up clients.assigned_to, which doesn't exist - the client's owner
--    is clients.primary_contact_id (an org member). Every portal "add a task" failed.

alter function guard_org_billing_columns() security invoker;

create or replace function client_add_task(p_title text, p_notes text default null, p_due date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_client_id();
  oid uuid;
  assignee uuid;
  new_id uuid;
  clean_title text := btrim(coalesce(p_title, ''));
begin
  if cid is null then raise exception 'not a client user'; end if;
  if length(clean_title) = 0 or length(clean_title) > 200 then raise exception 'title must be 1-200 characters'; end if;
  if p_notes is not null and length(p_notes) > 2000 then raise exception 'notes too long'; end if;
  if p_due is not null and (p_due < current_date - 1 or p_due > current_date + 730) then raise exception 'due date out of range'; end if;

  select c.org_id, c.primary_contact_id into oid, assignee from clients c where c.id = cid;
  if assignee is not null and not exists (
    select 1 from org_members m where m.org_id = oid and m.user_id = assignee and m.status = 'active'
  ) then
    assignee := null;
  end if;
  if assignee is null then
    select m.user_id into assignee from org_members m
      where m.org_id = oid and m.status = 'active' and m.role in ('owner', 'admin')
      order by case m.role when 'owner' then 0 else 1 end, m.created_at
      limit 1;
  end if;

  insert into tasks (org_id, client_id, title, notes, due_date, original_due_date, priority, done, status,
                     assigned_to, assignee_ids, client_visible, requested_by)
  values (oid, cid, clean_title, coalesce(btrim(p_notes), ''), coalesce(p_due, current_date), coalesce(p_due, current_date),
          'Medium', false, 'todo', assignee, case when assignee is null then '{}'::uuid[] else array[assignee] end,
          true, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

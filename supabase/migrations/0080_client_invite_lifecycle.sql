-- Client portal, part 2: client invites reuse the exact same /accept-invite flow and
-- has_pending_invite/accept_own_invite RPCs as team invites (0045, 0067) - a user only ever
-- has a pending row in one of org_members or client_users, so checking/updating both here is
-- harmless and lets the accept page stay generic about which kind of invite it's finishing.

create or replace function has_pending_invite()
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from org_members where user_id = auth.uid() and status = 'invited')
    or exists (select 1 from client_users where user_id = auth.uid() and status = 'invited');
$$;

create or replace function accept_own_invite()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update org_members set status = 'active', joined_at = now()
    where user_id = auth.uid() and status = 'invited';
  update client_users set status = 'active', joined_at = now()
    where user_id = auth.uid() and status = 'invited';
end;
$$;

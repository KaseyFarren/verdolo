-- /accept-invite's fallback path (old-style hash-fragment invite links) treated "a session
-- exists" as proof of a valid invite - but org_members_select requires status='active'
-- (is_org_member), so a client-side check for the caller's own 'invited' row returns nothing
-- even for a real invitee, and returns nothing for an unrelated already-logged-in user too,
-- collapsing the two cases the check exists to tell apart. A narrow security-definer RPC scoped
-- to auth.uid() (mirrors claim_purchase_token in 0052) sidesteps RLS just for this one check.
create or replace function has_pending_invite()
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from org_members where user_id = auth.uid() and status = 'invited'
  );
$$;

grant execute on function has_pending_invite() to authenticated;

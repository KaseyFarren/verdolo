-- Makes org_members.status = 'invited' meaningful again (the invite route previously set
-- 'active' immediately, so a pending-not-yet-accepted invite was indistinguishable from a real
-- active member everywhere - seat counts, member pickers, the dormant "invited" badge in the
-- Team UI). Now an invite starts as 'invited' and only flips to 'active' once the person
-- actually finishes account setup, via this RPC.

-- security definer so the invited user (who has no admin rights) can flip their own row -
-- scoped to auth.uid() and 'invited' -> 'active' only, can't touch anyone else's membership.
create or replace function accept_own_invite()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update org_members
  set status = 'active', joined_at = now()
  where user_id = auth.uid() and status = 'invited';
end;
$$;

-- Client portal, part 4: two correctness gaps found on review.
--
-- 1. requireOrgContext() paywall-gates every team page against org.subscription_status, but
--    getClientContext() had no equivalent - a client portal stayed fully readable/writable even
--    after the org's own Verdolo subscription lapsed. orgs_select requires is_org_member(id), so
--    a client can't read that table directly; this RPC does the hasActiveAccess check (mirrors
--    org.ts) server-side, scoped to a client the caller actually belongs to.
--
-- 2. /accept-invite showed identical "join a team" copy for every invite. Client invites need
--    their own copy - this RPC tells the page which kind of pending invite (if any) the caller
--    has, without exposing anything has_pending_invite() didn't already reveal (the caller's own
--    pending-invite existence).

create or replace function client_org_has_active_access(target_client_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from clients c join orgs o on o.id = c.org_id
    where c.id = target_client_id
      and is_client_user(target_client_id)
      and (
        o.subscription_status in ('active', 'past_due')
        or (o.subscription_status = 'trialing' and (o.trial_ends_at is null or o.trial_ends_at > now()))
      )
  );
$$;

create or replace function pending_invite_kind()
returns text
language sql security definer stable set search_path = public as $$
  select case
    when exists (select 1 from org_members where user_id = auth.uid() and status = 'invited') then 'team'
    when exists (select 1 from client_users where user_id = auth.uid() and status = 'invited') then 'client'
    else null
  end;
$$;

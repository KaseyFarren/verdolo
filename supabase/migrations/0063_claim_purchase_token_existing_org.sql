-- claim_purchase_token always inserted a brand-new orgs + org_members row, even when the
-- claiming user already owned an active org (e.g. they started a trial via /signup, then bought
-- the lifetime/monthly plan through the external Payment Link with the same email). That forked
-- a second, empty org while leaving their real trialing org - with all its clients/tasks/time
-- entries/messages - untouched and unreachable, since getOrgContext()/page.tsx use
-- .maybeSingle() on org_members and error out once a user has 2+ rows there. Both /onboarding and
-- /dashboard then redirect to each other forever.
--
-- Fix: if the caller already owns an active org, upgrade that org in place (including renaming
-- it to whatever they typed on this screen) instead of inserting a second one, and skip the
-- duplicate org_members insert.
create or replace function claim_purchase_token(p_session_id text, p_org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  token_row purchase_tokens%rowtype;
  new_org_id uuid;
  caller_email text;
  existing_org_id uuid;
begin
  select * into token_row
  from purchase_tokens
  where stripe_checkout_session_id = p_session_id
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invalid_or_expired_token';
  end if;

  select email into caller_email from auth.users where id = auth.uid();

  if caller_email is null or lower(caller_email) <> lower(token_row.email) then
    raise exception 'invalid_or_expired_token';
  end if;

  select org_id into existing_org_id
  from org_members
  where user_id = auth.uid() and role = 'owner' and status = 'active'
  limit 1;

  if existing_org_id is not null then
    update orgs
    set name = p_org_name,
        subscription_status = 'active',
        plan_type = token_row.plan_type,
        seats_purchased = token_row.seats_purchased,
        stripe_customer_id = token_row.stripe_customer_id,
        stripe_subscription_id = token_row.stripe_subscription_id,
        updated_at = now()
    where id = existing_org_id;

    new_org_id := existing_org_id;
  else
    insert into orgs (name, subscription_status, plan_type, seats_purchased, stripe_customer_id, stripe_subscription_id)
    values (p_org_name, 'active', token_row.plan_type, token_row.seats_purchased, token_row.stripe_customer_id, token_row.stripe_subscription_id)
    returning id into new_org_id;

    insert into org_members (org_id, user_id, role, status, joined_at)
    values (new_org_id, auth.uid(), 'owner', 'active', now());
  end if;

  update purchase_tokens
  set status = 'claimed', claimed_by = auth.uid(), claimed_at = now()
  where id = token_row.id;

  return new_org_id;
end;
$$;

-- Security hardening: `supabase db advisors --linked --type security` flagged every SECURITY
-- DEFINER function as callable by anon/authenticated via PostgREST RPC. Most are correctly
-- scoped to auth.uid() and fine to stay public. Two aren't:

-- 1. consume_ai_credit / check_rate_limit are only ever called server-side with the service-role
--    key (lib/aiCredits.ts, lib/rateLimit.ts) and never check the caller against p_org_id /
--    the bucket owner. Left grantable to anon/authenticated, any client holding the public anon
--    key could call them directly to grief another org's AI-credit allowance or rate-limit bucket.
--    service_role bypasses grants entirely, so revoking here doesn't affect real callers.
revoke execute on function consume_ai_credit(uuid, int) from anon, authenticated;
revoke execute on function check_rate_limit(text, int, int) from anon, authenticated;

-- Trigger-only functions have no legitimate direct-call path either (they error outside
-- trigger context), but there's no reason to leave EXECUTE grantable.
revoke execute on function guard_org_member_self_update() from anon, authenticated;
revoke execute on function guard_parent_completion() from anon, authenticated;
revoke execute on function guard_task_subtask() from anon, authenticated;
revoke execute on function messages_after_insert() from anon, authenticated;
revoke execute on function set_message_reaction_context() from anon, authenticated;
revoke execute on function rls_auto_enable() from anon, authenticated;

-- 2. claim_purchase_token is legitimately called client-side (create-account-form.tsx) and has
--    to stay public, but it never checked that the claiming user's email matches the purchase -
--    only that the caller holds a valid, unexpired, still-pending stripe_checkout_session_id.
--    The UI's readonly email field is cosmetic; the RPC itself is the only real boundary. Add
--    the email check so a leaked/guessed session id can't be claimed by a different account.
create or replace function claim_purchase_token(p_session_id text, p_org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  token_row purchase_tokens%rowtype;
  new_org_id uuid;
  caller_email text;
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

  insert into orgs (name, subscription_status, plan_type, seats_purchased, stripe_customer_id, stripe_subscription_id)
  values (p_org_name, 'active', token_row.plan_type, token_row.seats_purchased, token_row.stripe_customer_id, token_row.stripe_subscription_id)
  returning id into new_org_id;

  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());

  update purchase_tokens
  set status = 'claimed', claimed_by = auth.uid(), claimed_at = now()
  where id = token_row.id;

  return new_org_id;
end;
$$;

-- 3. Two functions had a mutable search_path (function_search_path_mutable advisor warning).
-- Pinning it via ALTER instead of redefining the body avoids re-typing logic we didn't need to touch.
alter function set_updated_at() set search_path = public;
alter function freeze_original_due_date() set search_path = public;

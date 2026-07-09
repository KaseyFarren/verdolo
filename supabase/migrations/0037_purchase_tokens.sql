-- A buyer completes a Stripe Payment Link purchase before ever having an account. The webhook
-- (checkout.session.completed with no org_id metadata) records the purchase here, keyed by the
-- checkout session id Stripe substitutes into the Payment Link's redirect URL. /create-account
-- looks the row up and claims it via claim_purchase_token, which is the only path that can turn
-- a token into a real org - so a missing/expired/already-claimed token can never create a free org.

create table if not exists purchase_tokens (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text unique not null,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  plan_type text not null default 'subscription' check (plan_type in ('subscription', 'lifetime')),
  email text not null,
  seats_purchased integer not null default 2,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists purchase_tokens_email_idx on purchase_tokens(email);

alter table purchase_tokens enable row level security;
-- No client-facing policies at all - only the service-role webhook (insert/upsert) and the
-- security-definer RPC below (select/update) ever touch this table, same posture as `orgs`.

create or replace function claim_purchase_token(p_session_id text, p_org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  token_row purchase_tokens%rowtype;
  new_org_id uuid;
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

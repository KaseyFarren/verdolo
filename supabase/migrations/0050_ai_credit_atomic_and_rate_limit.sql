-- Security hardening (see NEXT_SESSION.md security pass):
--  1. consume_ai_credit(): atomic, row-locked replacement for the read-then-write in
--     lib/aiCredits.ts, which under concurrency let parallel AI requests blow past the
--     monthly cap (last-write-wins undercounted the used counter).
--  2. rate_limits + check_rate_limit(): a fixed-window limiter, atomic via a single upsert,
--     for expensive/unauthenticated routes (AI generation, pre-signup lookup).

-- 1. Atomic AI-credit consume ------------------------------------------------------------
-- Tier/limit stays computed in the app (it depends on live seat count); this just does the
-- check-and-increment atomically under a row lock so concurrent calls can't overspend.
create or replace function consume_ai_credit(p_org_id uuid, p_limit int)
returns table(allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reset timestamptz;
  v_used int;
  v_new_period boolean;
begin
  select ai_credits_used, ai_credits_reset_at
    into v_used, v_reset
    from orgs where id = p_org_id
    for update;

  if not found then
    return query select false, 0;
    return;
  end if;

  -- Reset on the calendar month (UTC), matching the previous JS logic.
  v_new_period := v_reset is null
    or date_trunc('month', v_reset at time zone 'utc') <> date_trunc('month', now() at time zone 'utc');
  if v_new_period then
    v_used := 0;
  end if;

  if v_used >= p_limit then
    return query select false, v_used;
    return;
  end if;

  update orgs
    set ai_credits_used = v_used + 1,
        ai_credits_reset_at = case when v_new_period then now() else ai_credits_reset_at end
    where id = p_org_id;

  return query select true, v_used + 1;
end;
$$;

-- 2. Fixed-window rate limiter -----------------------------------------------------------
create table if not exists rate_limits (
  bucket text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);
-- Only ever touched by the service role via check_rate_limit(); no user should read it.
alter table rate_limits enable row level security;

-- Returns true if the call is allowed (i.e. still under p_max within the current window).
-- The upsert is a single atomic statement, so concurrent callers can't race the counter.
create or replace function check_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (bucket, count, window_start)
    values (p_bucket, 1, now())
  on conflict (bucket) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else rate_limits.window_start
        end
    returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Trials now include 2 extra seats (3 total, matching the $29 tier's "up to 3" bracket) instead
-- of just the owner, so a team can actually invite teammates to try it out before paying.

create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name, subscription_status, trial_ends_at, seats_purchased)
  values (org_name, 'trialing', now() + interval '14 days', 3)
  returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());
  insert into message_threads (org_id, kind) values (new_org_id, 'team');
  return new_org_id;
end;
$$;

-- Bump orgs already mid-trial up to the new default too, so the seat cap enforced in
-- /api/invite (see accompanying app change) doesn't retroactively lock out an existing trial.
update orgs set seats_purchased = 3 where subscription_status = 'trialing' and seats_purchased < 3;

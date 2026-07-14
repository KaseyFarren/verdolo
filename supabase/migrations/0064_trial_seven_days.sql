-- Shorten the self-signup trial from 14 to 7 days.

create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name, subscription_status, trial_ends_at, seats_purchased)
  values (org_name, 'trialing', now() + interval '7 days', 3)
  returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'owner', 'active', now());
  insert into message_threads (org_id, kind) values (new_org_id, 'team');
  return new_org_id;
end;
$$;

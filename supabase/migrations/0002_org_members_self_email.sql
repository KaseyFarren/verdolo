create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
  caller_email text;
begin
  select email into caller_email from auth.users where id = auth.uid();

  insert into orgs (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at, invited_email)
  values (new_org_id, auth.uid(), 'admin', 'active', now(), caller_email);
  return new_org_id;
end;
$$;

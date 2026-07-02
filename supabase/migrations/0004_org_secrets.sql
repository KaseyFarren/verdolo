-- orgs.anthropic_api_key_encrypted is readable by any org member (orgs_select policy
-- allows all active members, not just admins), so secrets can't live on that table.
-- Keep them in a dedicated table with admin-only RLS instead.
create table org_secrets (
  org_id uuid primary key references orgs(id) on delete cascade,
  anthropic_api_key text
);

alter table org_secrets enable row level security;

create policy org_secrets_select on org_secrets for select using (is_org_admin(org_id));
create policy org_secrets_upsert on org_secrets for insert with check (is_org_admin(org_id));
create policy org_secrets_update on org_secrets for update using (is_org_admin(org_id));

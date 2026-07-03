-- Lets the Time page prune old raw time_entries without corrupting lifetime stats elsewhere.
-- Clients' lifetime hours and the Time page's own by-client/by-teammate totals both sum raw
-- time_entries live with no cache, so a blanket delete would silently zero them out. Clearing
-- old entries rolls the deleted rows' totals into this table first (see clearOldEntries in
-- TimeClient.tsx), then deletes the raw rows - only per-entry detail is lost, not the totals.
create table time_archived_totals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  seconds integer not null default 0,
  billable_seconds integer not null default 0,
  updated_at timestamptz not null default now()
);

create index time_archived_totals_org_idx on time_archived_totals (org_id, client_id, user_id);

alter table time_archived_totals enable row level security;

create policy time_archived_totals_select on time_archived_totals for select
  using (is_org_member(org_id));

-- Clearing is an admin-only action (wired in TimeClient.tsx), so only admins/owners may write.
create policy time_archived_totals_insert on time_archived_totals for insert
  with check (is_org_admin(org_id));

create policy time_archived_totals_update on time_archived_totals for update
  using (is_org_admin(org_id));

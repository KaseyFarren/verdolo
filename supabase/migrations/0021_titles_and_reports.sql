-- Job-title label per member (distinct from the owner/admin/member permission role), and
-- persisted weekly recaps so they survive a refresh and can be browsed as history.

alter table org_members add column if not exists title text;

-- One row per org per week: regenerating a week's recap upserts in place instead of growing
-- the table, so a year of history is ~52 tiny rows/org, not one row per click.
create table weekly_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  week_start date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, week_start)
);
create index weekly_reports_org_id_idx on weekly_reports(org_id);
create trigger weekly_reports_set_updated_at before update on weekly_reports
  for each row execute function set_updated_at();

alter table weekly_reports enable row level security;

create policy weekly_reports_select on weekly_reports for select using (is_org_member(org_id));
create policy weekly_reports_insert on weekly_reports for insert with check (is_org_member(org_id));
create policy weekly_reports_update on weekly_reports for update using (is_org_member(org_id));

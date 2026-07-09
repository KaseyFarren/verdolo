-- Generalizes weekly_reports into a period-agnostic reports table: the Reports page needs to
-- store monthly recaps too (not just weekly), and to backfill/regenerate an arbitrary past
-- period instead of always "this week" / "current month".
create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period_type, period_start)
);
create index reports_org_id_idx on reports(org_id);
create trigger reports_set_updated_at before update on reports
  for each row execute function set_updated_at();

insert into reports (org_id, period_type, period_start, period_end, content, created_at, updated_at)
select org_id, 'week', week_start, week_start + 7, content, created_at, updated_at
from weekly_reports;

drop table weekly_reports;

alter table reports enable row level security;

create policy reports_select on reports for select using (is_org_member(org_id));
create policy reports_insert on reports for insert with check (is_org_member(org_id));
create policy reports_update on reports for update using (is_org_member(org_id));
-- weekly_reports never had a delete policy (RLS default-denies with no matching policy), so a
-- bad or wrongly-dated backfilled report could never be removed by anyone - admins can now.
create policy reports_delete on reports for delete using (is_org_admin(org_id));

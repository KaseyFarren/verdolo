-- In-app "report a problem" - stores the report and /api/bug-report emails APP_OWNER_EMAILS.
-- No select/update policy for org members - only the service-role admin client (used by
-- /admin/bug-reports) can read or update status, same as other admin-only tables.

create table bug_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  page_url text,
  description text not null,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now()
);
create index bug_reports_created_at_idx on bug_reports(created_at desc);

alter table bug_reports enable row level security;

create policy bug_reports_insert on bug_reports for insert
  with check (user_id = auth.uid() and (org_id is null or is_org_member(org_id)));

-- Personal, private-per-user scratchpad shown on the Dashboard. One note per (org, user) -
-- no history/list, just a single auto-saved free-text box (confirmed with the user: personal,
-- not shared across the team).
create table quick_notes (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table quick_notes enable row level security;

create policy quick_notes_select on quick_notes for select
  using (user_id = auth.uid() and is_org_member(org_id));

create policy quick_notes_insert on quick_notes for insert
  with check (user_id = auth.uid() and is_org_member(org_id));

create policy quick_notes_update on quick_notes for update
  using (user_id = auth.uid() and is_org_member(org_id));

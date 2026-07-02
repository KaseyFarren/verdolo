create extension if not exists pgcrypto;

-- ============ ORGS ============

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_connect_account_id text,
  anthropic_api_key_encrypted text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')) default 'member',
  invited_email text,
  status text not null check (status in ('invited', 'active')) default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- ============ RLS HELPERS ============
-- security definer so these bypass RLS internally (avoids recursive-policy issues on org_members)

create or replace function is_org_member(target_org_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function is_org_admin(target_org_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = target_org_id and user_id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

-- bootstraps the very first org for a newly signed-up user (chicken/egg: they can't
-- pass the org_members insert policy until they're already a member of the org)
create or replace function create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into orgs (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role, status, joined_at)
  values (new_org_id, auth.uid(), 'admin', 'active', now());
  return new_org_id;
end;
$$;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orgs_set_updated_at before update on orgs
  for each row execute function set_updated_at();

-- ============ CORE AGENCY DATA ============

create table clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  business text,
  platform text check (platform in ('WhatsApp', 'Email', 'Instagram DM', 'Slack', 'SMS', 'Telegram', 'Other')),
  service text,
  notes text,
  tone text check (tone in ('Casual', 'Friendly', 'Professional', 'Motivational')),
  talking_points text,
  cadence_days integer,
  stage text check (stage in ('Lead', 'Trial', 'Active', 'At Risk', 'Churned')) default 'Lead',
  retainer_cents integer default 0,
  contract_ends date,
  last_contacted date,
  added_date date default current_date,
  status text default 'active',
  contact_email text,
  contact_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_org_id_idx on clients(org_id);
create index clients_contact_domain_idx on clients(contact_domain);
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  due_date date,
  priority text check (priority in ('High', 'Medium', 'Low')) default 'Medium',
  notes text,
  done boolean not null default false,
  completed_at timestamptz,
  is_auto boolean not null default false,
  auto_type text,
  is_gcal boolean not null default false,
  gcal_id text,
  time time,
  recurring_id uuid,
  quick boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_org_id_idx on tasks(org_id);
create index tasks_assigned_to_idx on tasks(assigned_to);
create index tasks_client_id_idx on tasks(client_id);
create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();

create table recurring_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  priority text check (priority in ('High', 'Medium', 'Low')) default 'Medium',
  frequency text check (frequency in ('daily', 'weekly', 'monthly')) not null,
  notes text,
  created_at timestamptz not null default now()
);
create index recurring_templates_org_id_idx on recurring_templates(org_id);

alter table tasks add constraint tasks_recurring_id_fkey
  foreign key (recurring_id) references recurring_templates(id) on delete set null;

create table client_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);
create index client_notes_client_id_idx on client_notes(client_id);

-- ============ TIME TRACKING ============

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  note text,
  billable boolean not null default true,
  created_at timestamptz not null default now()
);
create index time_entries_org_id_idx on time_entries(org_id);
create index time_entries_client_id_idx on time_entries(client_id);
create index time_entries_user_id_idx on time_entries(user_id);

-- ============ INTEGRATIONS ============

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'gmail', 'slack')),
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scope text,
  external_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index integration_connections_org_id_idx on integration_connections(org_id);
create trigger integration_connections_set_updated_at before update on integration_connections
  for each row execute function set_updated_at();

create table inbox_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  provider text not null check (provider in ('gmail', 'slack')),
  external_thread_id text not null,
  participant text,
  subject_or_channel text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, provider, external_thread_id)
);
create index inbox_threads_org_id_idx on inbox_threads(org_id);
create index inbox_threads_client_id_idx on inbox_threads(client_id);

create table inbox_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  thread_id uuid not null references inbox_threads(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text,
  body text,
  sent_at timestamptz not null,
  external_message_id text,
  created_at timestamptz not null default now()
);
create index inbox_messages_thread_id_idx on inbox_messages(thread_id);

-- ============ PROPOSALS / BILLING ============

create table proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  doc_url text,
  status text not null check (status in ('draft', 'sent', 'signed', 'declined')) default 'draft',
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proposals_org_id_idx on proposals(org_id);
create trigger proposals_set_updated_at before update on proposals
  for each row execute function set_updated_at();

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  stripe_invoice_id text,
  amount_cents integer not null,
  status text not null check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')) default 'draft',
  period_start date,
  period_end date,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_org_id_idx on invoices(org_id);
create index invoices_client_id_idx on invoices(client_id);
create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();

create table ai_message_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  generated_by uuid references auth.users(id) on delete set null,
  prompt_summary text,
  message text,
  created_at timestamptz not null default now()
);
create index ai_message_log_org_id_idx on ai_message_log(org_id);

-- ============ RLS ============

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table clients enable row level security;
alter table tasks enable row level security;
alter table recurring_templates enable row level security;
alter table client_notes enable row level security;
alter table time_entries enable row level security;
alter table integration_connections enable row level security;
alter table inbox_threads enable row level security;
alter table inbox_messages enable row level security;
alter table proposals enable row level security;
alter table invoices enable row level security;
alter table ai_message_log enable row level security;

create policy orgs_select on orgs for select using (is_org_member(id));
create policy orgs_update on orgs for update using (is_org_admin(id));

create policy org_members_select on org_members for select using (is_org_member(org_id));
create policy org_members_insert on org_members for insert with check (is_org_admin(org_id));
create policy org_members_update on org_members for update using (is_org_admin(org_id));
create policy org_members_delete on org_members for delete using (is_org_admin(org_id));

create policy clients_select on clients for select using (is_org_member(org_id));
create policy clients_write on clients for insert with check (is_org_member(org_id));
create policy clients_update on clients for update using (is_org_member(org_id));
create policy clients_delete on clients for delete using (is_org_admin(org_id));

create policy tasks_select on tasks for select using (is_org_member(org_id));
create policy tasks_insert on tasks for insert with check (is_org_member(org_id));
create policy tasks_update on tasks for update using (is_org_member(org_id));
create policy tasks_delete on tasks for delete using (is_org_member(org_id));

create policy recurring_templates_all on recurring_templates for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy client_notes_select on client_notes for select using (is_org_member(org_id));
create policy client_notes_insert on client_notes for insert with check (is_org_member(org_id));

create policy time_entries_select on time_entries for select using (is_org_member(org_id));
create policy time_entries_insert on time_entries for insert
  with check (is_org_member(org_id) and user_id = auth.uid());
create policy time_entries_update on time_entries for update
  using (is_org_member(org_id) and (user_id = auth.uid() or is_org_admin(org_id)));
create policy time_entries_delete on time_entries for delete
  using (user_id = auth.uid() or is_org_admin(org_id));

-- integration_connections holds encrypted OAuth tokens: admins can see connection
-- metadata, but decrypting/using tokens happens server-side only, via the service
-- role key, never through this RLS-scoped client path.
create policy integration_connections_select on integration_connections for select using (is_org_admin(org_id));
create policy integration_connections_all on integration_connections for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

create policy inbox_threads_select on inbox_threads for select using (is_org_member(org_id));
create policy inbox_messages_select on inbox_messages for select using (is_org_member(org_id));

create policy proposals_select on proposals for select using (is_org_member(org_id));
create policy proposals_write on proposals for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy invoices_select on invoices for select using (is_org_member(org_id));
create policy invoices_write on invoices for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

create policy ai_message_log_select on ai_message_log for select using (is_org_member(org_id));
create policy ai_message_log_insert on ai_message_log for insert with check (is_org_member(org_id));

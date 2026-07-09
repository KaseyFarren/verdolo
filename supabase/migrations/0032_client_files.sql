-- Client file storage - brand guides, docs, and other reference files attached to a client.

create table client_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_files_client_id_idx on client_files(client_id);

alter table client_files enable row level security;

create policy client_files_select on client_files for select using (is_org_member(org_id));
create policy client_files_insert on client_files for insert with check (is_org_member(org_id));
create policy client_files_delete on client_files for delete using (is_org_member(org_id));

-- private bucket (client docs may be sensitive) - path convention: {org_id}/{client_id}/{filename}
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

create policy client_files_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'client-files' and is_org_member((storage.foldername(name))[1]::uuid));

create policy client_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and is_org_member((storage.foldername(name))[1]::uuid));

create policy client_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and is_org_member((storage.foldername(name))[1]::uuid));

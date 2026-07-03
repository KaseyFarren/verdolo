alter table clients
  add column primary_contact_id uuid references auth.users(id) on delete set null;
create index clients_primary_contact_id_idx on clients(primary_contact_id);

alter table inbox_messages
  add column user_id uuid references auth.users(id) on delete set null;

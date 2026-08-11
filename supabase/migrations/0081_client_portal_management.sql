-- Client portal, part 3: org-admin management of client_users (revoke access from the client
-- detail panel) and file delete for client users - mirrors org_members_delete (0001/0010) and
-- extends client_files delete (0032) the same way select/insert were extended in 0079.

create policy client_users_insert on client_users for insert with check (is_org_admin(org_id));
create policy client_users_delete on client_users for delete using (is_org_admin(org_id));

create policy client_files_client_delete on client_files for delete using (is_client_user(client_id));

create policy client_files_storage_client_delete on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and is_client_user((storage.foldername(name))[2]::uuid));

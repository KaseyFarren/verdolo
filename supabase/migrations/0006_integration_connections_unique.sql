alter table integration_connections
  add constraint integration_connections_org_user_provider_key unique (org_id, user_id, provider);

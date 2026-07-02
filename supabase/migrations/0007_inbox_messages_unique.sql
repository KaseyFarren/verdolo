alter table inbox_messages
  add constraint inbox_messages_org_external_message_key unique (org_id, external_message_id);

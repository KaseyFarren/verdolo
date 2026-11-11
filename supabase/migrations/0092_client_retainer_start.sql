alter table clients add column retainer_starts_on date;
comment on column clients.retainer_starts_on is 'First day the retainer is billed. Null means count from creation (added_date), as before.';

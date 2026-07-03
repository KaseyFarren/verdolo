-- Lets a recurring template be temporarily paused (stop generating new daily/weekly instances)
-- without deleting it and losing its config/history.
alter table recurring_templates add column if not exists paused boolean not null default false;

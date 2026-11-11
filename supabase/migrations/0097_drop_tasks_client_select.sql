-- Second half of 0096: the portal now reads through portal_tasks(), so remove clients' direct
-- read access to the tasks table (which exposed notes and other internal fields via the API).
drop policy if exists tasks_client_select on tasks;

-- OAuth tokens must never reach the browser, even for admins (a token visible in an
-- admin's network tab is a token that's leaked). Drop the RLS policies entirely so
-- this table is reachable only via the service-role client from server routes.
drop policy if exists integration_connections_select on integration_connections;
drop policy if exists integration_connections_all on integration_connections;

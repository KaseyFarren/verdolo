-- SECURITY FIXES from the 11 Nov 2026 RLS audit (each confirmed live on prod with throwaway users).
--
-- 1. CRITICAL: client_users insert/update only checked is_org_admin(org_id), never that client_id
--    belongs to that org. Every self-signup is the owner of their own org, so anyone could link
--    themselves to ANY client and read its portal (tasks, projects, files, messages).
-- 2. HIGH: owners could write billing columns on orgs directly (subscription_status, plan_type,
--    seats_purchased, trial_ends_at, stripe_customer_id ...) - free paid access, and a forged
--    stripe_customer_id would show another customer's invoices.
-- 3. MEDIUM: nothing stopped a row in one org pointing at another org's client/project/task/
--    thread (e.g. a task injected into someone else's client portal).
-- 4. LOW: org_members self-update guard skipped admins entirely; pin org/user for everyone.
--
-- Direct API writes run as the `authenticated` role; security definer functions run as their
-- owner and the service role as `service_role`, so current_user tells "a browser wrote this"
-- apart from trusted server code.

-- ============ 1. client_users must reference a client in the same org ============

drop policy if exists client_users_insert on client_users;
create policy client_users_insert on client_users for insert
  with check (
    is_org_admin(org_id)
    and exists (select 1 from clients c where c.id = client_users.client_id and c.org_id = client_users.org_id)
  );

drop policy if exists client_users_update on client_users;
create policy client_users_update on client_users for update
  using (is_org_admin(org_id))
  with check (
    is_org_admin(org_id)
    and exists (select 1 from clients c where c.id = client_users.client_id and c.org_id = client_users.org_id)
  );

-- Belt and braces at the table level too (covers every write path, incl. the self-update policy).
create or replace function guard_client_users_org()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client does not belong to this org';
  end if;
  return new;
end;
$$;
drop trigger if exists client_users_guard_org on client_users;
create trigger client_users_guard_org before insert or update on client_users
  for each row execute function guard_client_users_org();

-- Any rows already pointing across orgs are forged by definition - remove them.
delete from client_users cu using clients c where c.id = cu.client_id and c.org_id <> cu.org_id;

-- ============ 2. billing columns on orgs are server-only ============

create or replace function guard_org_billing_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.subscription_status := old.subscription_status;
    new.plan_type := old.plan_type;
    new.seats_purchased := old.seats_purchased;
    new.trial_ends_at := old.trial_ends_at;
    new.current_period_end := old.current_period_end;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.stripe_connect_account_id := old.stripe_connect_account_id;
    new.ai_credits_used := old.ai_credits_used;
    new.ai_credits_reset_at := old.ai_credits_reset_at;
  end if;
  return new;
end;
$$;
drop trigger if exists orgs_guard_billing on orgs;
create trigger orgs_guard_billing before update on orgs
  for each row execute function guard_org_billing_columns();

-- ============ 3. references must stay inside the row's own org ============

create or replace function same_org(ref_table text, ref_id uuid, expected_org uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare found_org uuid;
begin
  if ref_id is null then return true; end if;
  execute format('select org_id from %I where id = $1', ref_table) into found_org using ref_id;
  return found_org is not distinct from expected_org;
end;
$$;
revoke execute on function same_org(text, uuid, uuid) from public, anon, authenticated;

create or replace function guard_tasks_org_refs()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (same_org('clients', new.client_id, new.org_id) and same_org('projects', new.project_id, new.org_id)
          and same_org('project_phases', new.phase_id, new.org_id) and same_org('budgets', new.budget_id, new.org_id)
          and same_org('tasks', new.parent_task_id, new.org_id)) then
    raise exception 'task references a record from another org';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard_org_refs on tasks;
create trigger tasks_guard_org_refs before insert or update of org_id, client_id, project_id, phase_id, budget_id, parent_task_id on tasks
  for each row execute function guard_tasks_org_refs();

create or replace function guard_client_ref_org()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not same_org('clients', new.client_id, new.org_id) then
    raise exception 'record references a client from another org';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_org_refs on projects;
create trigger projects_guard_org_refs before insert or update of org_id, client_id on projects
  for each row execute function guard_client_ref_org();
drop trigger if exists client_files_guard_org_refs on client_files;
create trigger client_files_guard_org_refs before insert or update of org_id, client_id on client_files
  for each row execute function guard_client_ref_org();
drop trigger if exists client_charges_guard_org_refs on client_charges;
create trigger client_charges_guard_org_refs before insert or update of org_id, client_id on client_charges
  for each row execute function guard_client_ref_org();
drop trigger if exists budgets_guard_org_refs on budgets;
create trigger budgets_guard_org_refs before insert or update of org_id, client_id on budgets
  for each row execute function guard_client_ref_org();
drop trigger if exists recurring_templates_guard_org_refs on recurring_templates;
create trigger recurring_templates_guard_org_refs before insert or update of org_id, client_id on recurring_templates
  for each row execute function guard_client_ref_org();

create or replace function guard_time_entries_org_refs()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (same_org('clients', new.client_id, new.org_id) and same_org('tasks', new.task_id, new.org_id)
          and same_org('budgets', new.budget_id, new.org_id)) then
    raise exception 'time entry references a record from another org';
  end if;
  return new;
end;
$$;
drop trigger if exists time_entries_guard_org_refs on time_entries;
create trigger time_entries_guard_org_refs before insert or update of org_id, client_id, task_id, budget_id on time_entries
  for each row execute function guard_time_entries_org_refs();

create or replace function guard_project_phases_org_refs()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not same_org('projects', new.project_id, new.org_id) then
    raise exception 'phase references a project from another org';
  end if;
  return new;
end;
$$;
drop trigger if exists project_phases_guard_org_refs on project_phases;
create trigger project_phases_guard_org_refs before insert or update of org_id, project_id on project_phases
  for each row execute function guard_project_phases_org_refs();

create or replace function guard_messages_org_refs()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (same_org('message_threads', new.thread_id, new.org_id)) then
    raise exception 'message references a thread from another org';
  end if;
  if new.parent_message_id is not null and not exists (
    select 1 from messages p where p.id = new.parent_message_id and p.thread_id = new.thread_id
  ) then
    raise exception 'reply must be in the same thread';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_guard_org_refs on messages;
create trigger messages_guard_org_refs before insert or update of org_id, thread_id, parent_message_id on messages
  for each row execute function guard_messages_org_refs();

-- task_comments (0091): org_id must match the task's org (insert policy checks it too).
create or replace function guard_task_comments_org_refs()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not same_org('tasks', new.task_id, new.org_id) then
    raise exception 'comment references a task from another org';
  end if;
  return new;
end;
$$;
drop trigger if exists task_comments_guard_org_refs on task_comments;
create trigger task_comments_guard_org_refs before insert or update on task_comments
  for each row execute function guard_task_comments_org_refs();

-- client_files insert from the portal: the org must be the client's org.
create or replace function client_in_org(target_client_id uuid, target_org_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients where id = target_client_id and org_id = target_org_id);
$$;
revoke execute on function client_in_org(uuid, uuid) from public, anon;
grant execute on function client_in_org(uuid, uuid) to authenticated;

drop policy if exists client_files_client_insert on client_files;
create policy client_files_client_insert on client_files for insert
  with check (is_client_user(client_id) and client_in_org(client_id, org_id));

-- ============ 4. org_members: nobody (admin or not) moves a membership row ============

create or replace function guard_org_member_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    raise exception 'cannot move a membership to another org or user';
  end if;
  if not is_org_admin(old.org_id) then
    if old.user_id = auth.uid()
      and old.status = 'invited' and new.status = 'active'
      and new.role is not distinct from old.role then
      return new;
    end if;
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'cannot change role, status, org, or user via self-update';
    end if;
  end if;
  return new;
end;
$$;

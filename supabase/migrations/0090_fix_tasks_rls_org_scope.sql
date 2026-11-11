-- SECURITY FIX: the assignee-scoped task policies (0011, widened in 0049) never checked that the
-- caller belongs to the task's org. "assigned_to is null" on its own let ANY signed-in user
-- (anyone can sign up, plus every client-portal user) read, edit and delete every unassigned
-- task in every org. Verified on prod 11 Nov 2026 with a user in no org.
--
-- Same rules as before, now inside the org: members see/mutate tasks assigned to them or
-- unassigned, admins/owners see everything. Client-portal access stays on its own policies.

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    is_org_member(org_id) and (
      assigned_to = auth.uid() or assigned_to is null
      or assignee_ids @> array[auth.uid()]::uuid[]
      or is_org_admin(org_id)
    )
  );

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (
    is_org_member(org_id) and (
      assigned_to = auth.uid() or assigned_to is null
      or assignee_ids @> array[auth.uid()]::uuid[]
      or is_org_admin(org_id)
    )
  )
  with check (is_org_member(org_id));

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete
  using (
    is_org_member(org_id) and (
      assigned_to = auth.uid() or assigned_to is null
      or assignee_ids @> array[auth.uid()]::uuid[]
      or is_org_admin(org_id)
    )
  );

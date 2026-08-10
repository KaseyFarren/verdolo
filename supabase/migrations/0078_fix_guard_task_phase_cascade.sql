-- Fix: deleting a project 400'd on the DELETE itself. tasks references projects twice - once
-- directly (project_id, on delete set null) and once indirectly (phase_id -> project_phases ->
-- projects, phase_id also on delete set null). Postgres processes those two FK cascade actions
-- as separate UPDATEs within the same statement, so guard_task_phase() (0077) could observe a
-- task mid-cascade with project_id already nulled but phase_id not yet nulled - a state that
-- looks like "phase belongs to a different project" and got rejected, aborting the whole delete.
-- The check only matters when a task genuinely has both a project and a phase set; skip it
-- entirely once project_id is null; the phase_id SET NULL from the other cascade FK still lands
-- within the same statement regardless of ordering, so the row is fully consistent by commit.
create or replace function guard_task_phase()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  phase_project_id uuid;
  phase_org_id uuid;
begin
  if new.phase_id is not null and new.project_id is not null then
    select project_id, org_id into phase_project_id, phase_org_id
    from project_phases where id = new.phase_id;

    if phase_project_id is null then
      raise exception 'phase not found';
    end if;
    if phase_org_id is distinct from new.org_id then
      raise exception 'phase must belong to the same org as the task';
    end if;
    if phase_project_id is distinct from new.project_id then
      raise exception 'phase must belong to the task''s project';
    end if;
  end if;
  return new;
end;
$$;

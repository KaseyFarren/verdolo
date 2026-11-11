-- Fix: accepting an invite never worked. accept_own_invite() (0045/0080) flips the caller's own
-- org_members / client_users row from 'invited' to 'active', but the self-update guard triggers
-- (0012 for org_members, 0083 for client_users) reject any status change made by a non-admin
-- authenticated user, and a security definer function still runs with the caller's auth.uid().
-- So the RPC raised, the row stayed 'invited', and the invitee was sent back to /accept-invite
-- on every sign-in (a password-setup loop).
--
-- Both guards now allow exactly one self-transition: your own row, 'invited' -> 'active',
-- with nothing else changing except joined_at. Everything else they blocked stays blocked.
-- The client_users guard also gets the 0012 service-role bypass it was missing.

create or replace function guard_org_member_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not is_org_admin(old.org_id) then
    if old.user_id = auth.uid()
      and old.status = 'invited' and new.status = 'active'
      and new.role is not distinct from old.role
      and new.org_id is not distinct from old.org_id
      and new.user_id is not distinct from old.user_id then
      return new;
    end if;
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.org_id is distinct from old.org_id
      or new.user_id is distinct from old.user_id then
      raise exception 'cannot change role, status, org, or user via self-update';
    end if;
  end if;
  return new;
end;
$$;

create or replace function guard_client_user_self_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not is_org_admin(old.org_id) then
    if old.user_id = auth.uid()
      and old.status = 'invited' and new.status = 'active'
      and new.org_id is not distinct from old.org_id
      and new.client_id is not distinct from old.client_id
      and new.user_id is not distinct from old.user_id
      and new.invited_email is not distinct from old.invited_email then
      return new;
    end if;
    if new.status is distinct from old.status
      or new.org_id is distinct from old.org_id
      or new.client_id is distinct from old.client_id
      or new.user_id is distinct from old.user_id
      or new.invited_email is distinct from old.invited_email then
      raise exception 'cannot change status, org, client, user, or invited email via self-update';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function guard_client_user_self_update() from public, anon, authenticated;

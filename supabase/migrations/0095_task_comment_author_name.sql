-- Comments are read by both sides, but a client can't read org_members (and a teammate's view of
-- client_users is fine but awkward to join from the browser). Stamp the author's display name on
-- each comment server-side at insert, so it can't be spoofed and both sides can show it.

alter table task_comments add column author_name text;

create or replace function set_task_comment_author_name()
returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select coalesce(nullif(display_name, ''), split_part(invited_email, '@', 1)) into n
    from org_members where org_id = new.org_id and user_id = new.author_id limit 1;
  if n is null then
    select coalesce(nullif(display_name, ''), split_part(invited_email, '@', 1)) into n
      from client_users where org_id = new.org_id and user_id = new.author_id limit 1;
  end if;
  new.author_name := coalesce(n, 'Someone');
  return new;
end;
$$;
revoke execute on function set_task_comment_author_name() from public, anon, authenticated;

drop trigger if exists task_comments_set_author_name on task_comments;
create trigger task_comments_set_author_name before insert on task_comments
  for each row execute function set_task_comment_author_name();

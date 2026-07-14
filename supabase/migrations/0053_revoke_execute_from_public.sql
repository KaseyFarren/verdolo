-- 0052 revoked EXECUTE from anon/authenticated directly, but Postgres grants EXECUTE on new
-- functions to the PUBLIC pseudo-role by default, and anon/authenticated inherit through PUBLIC
-- regardless of a per-role revoke. Verified via has_function_privilege() after 0052 shipped -
-- both were still callable. The actual fix is revoking from PUBLIC and re-granting explicitly
-- to service_role, which is how the app really calls these (lib/aiCredits.ts, lib/rateLimit.ts).
revoke execute on function consume_ai_credit(uuid, int) from public;
grant execute on function consume_ai_credit(uuid, int) to service_role;

revoke execute on function check_rate_limit(text, int, int) from public;
grant execute on function check_rate_limit(text, int, int) to service_role;

revoke execute on function guard_org_member_self_update() from public;
revoke execute on function guard_parent_completion() from public;
revoke execute on function guard_task_subtask() from public;
revoke execute on function messages_after_insert() from public;
revoke execute on function set_message_reaction_context() from public;
revoke execute on function rls_auto_enable() from public;

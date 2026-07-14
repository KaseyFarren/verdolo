-- purchase_tokens.claimed_by references auth.users with no ON DELETE action, unlike every
-- other "who did this" audit column in the schema (created_by, generated_by, uploaded_by,
-- primary_contact_id all use ON DELETE SET NULL) - so deleting a user who claimed a token,
-- directly or via admin.auth.admin.deleteUser, fails with an opaque FK violation (Supabase Auth
-- surfaces it as a bare 500 with no message). It's an audit trail, not a hard requirement -
-- losing the pointer on user deletion is fine.

alter table purchase_tokens drop constraint if exists purchase_tokens_claimed_by_fkey;
alter table purchase_tokens add constraint purchase_tokens_claimed_by_fkey
  foreign key (claimed_by) references auth.users(id) on delete set null;

-- Org-level accent color for UI customization. Defaults to the purple already used for avatars
-- (AVATAR_COLORS[0] in src/lib/agency.ts) so existing orgs get a color that already matches.
alter table orgs add column if not exists accent_color text not null default '#7c5cbf';

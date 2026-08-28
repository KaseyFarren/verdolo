-- Turns proposals from a bare tracker (title/amount/notes + a pasted doc_url) into an actual
-- document: fixed-shape content rendered as a branded page a prospect opens via a share link
-- with no login, and accepts by typing their name.
--
-- content is JSONB, not a child table - sections are fixed-shape (overview, deliverables[],
-- pricing[], terms) and never queried across proposals, so a proposal_sections table would add
-- RLS + ordering + a realtime migration (see 0057) for no real gain.
--
-- share_token has NO client-facing RLS policy, following the purchase_tokens precedent (0037):
-- an anonymous visitor has no session, so every existing RLS policy on this table (is_org_member)
-- is unreachable to them anyway. The public page and the accept endpoint both read/write via the
-- service-role client instead - see src/app/proposal/[token]/page.tsx and
-- src/app/api/proposal/accept/route.ts.
--
-- status needs no constraint change - 'signed' is already legal (0001_init.sql).

alter table proposals add column if not exists content jsonb not null default '{}'::jsonb;
alter table proposals add column if not exists template text not null default 'standard';
alter table proposals add column if not exists share_token text;
alter table proposals add column if not exists share_revoked_at timestamptz;
alter table proposals add column if not exists accepted_at timestamptz;
alter table proposals add column if not exists accepted_by_name text;
alter table proposals add column if not exists accepted_ip text;

create unique index if not exists proposals_share_token_idx on proposals(share_token) where share_token is not null;

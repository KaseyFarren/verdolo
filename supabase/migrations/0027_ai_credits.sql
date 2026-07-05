-- Switch AI generation from bring-your-own-key (org_secrets.anthropic_api_key) to a
-- platform-paid Anthropic key (ANTHROPIC_API_KEY env var), gated by a monthly per-org
-- credit allowance tiered by active seat count. See src/lib/aiCredits.ts for the tiers.

drop table if exists org_secrets;

alter table orgs add column if not exists ai_credits_used int not null default 0;
alter table orgs add column if not exists ai_credits_reset_at timestamptz not null default now();

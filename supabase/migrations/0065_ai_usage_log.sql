-- Per-generation token/cost tracking for the 5 AI routes (src/lib/ai.ts::callClaude), so
-- /admin/ai-usage can show real spend instead of just credit counts (1 credit = 1 generation
-- regardless of which route or how many tokens it actually used). Written via the service-role
-- admin client only (see logAiUsage in src/lib/ai.ts) - no insert policy needed for org members.
-- cost_micros is USD * 1,000,000 (avoids float drift when summing many sub-cent generations);
-- divide by 1e6 to display dollars.

create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  route text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_micros bigint,
  created_at timestamptz not null default now()
);
create index ai_usage_log_org_id_idx on ai_usage_log(org_id);
create index ai_usage_log_created_at_idx on ai_usage_log(created_at desc);

alter table ai_usage_log enable row level security;

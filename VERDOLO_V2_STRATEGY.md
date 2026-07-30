# Verdolo V2 Strategy: Keep / Cut / Fix / Build

Analysis date: 2026-07-30. Based on a full read of the codebase (71 migrations, all app routes) plus current-market research on Productive.io, Scoro, Teamwork, and the ClickUp/Asana switching literature.

## Executive summary

Verdolo V1 is a well-built client operations tool with one real differentiator (AI client communications + relationship health) and one structural hole (no money loop: no projects, no budgets, no invoicing). The best platforms in this space (Productive, Scoro, Teamwork) all win on the same promise: "see whether every client is profitable, from quote to cash, in one tool." That is exactly the layer verdolo is missing, and it is also the #1 documented reason agencies abandon ClickUp/Asana/Monday.

The V2 thesis: keep verdolo's simplicity and AI comms edge, and add the financial spine (retainer burn, budgets, invoicing) plus a client-facing surface (portal + AI-written reports). Do not chase Scoro's ERP depth. Verdolo's wedge is the 2-8 person agency that finds Productive heavy and expensive (3-5 seat minimums, $11-39/user/mo) but has outgrown spreadsheets.

---

## 1. Feature-by-feature verdict

### Working well: keep and extend

**Client health model.** Cadence-based health (green/amber/red), daily health snapshots, stage pipeline, MRR-at-risk. No mainstream competitor tracks relationship health this way; they track project health. This is a genuine differentiator. Weakness: it depends entirely on `last_contacted` being updated by hand, which makes the whole signal only as good as user discipline. Fix in Phase 3 (Gmail integration auto-updates it).

**AI suite.** Seven routes (client updates, daily messages, one-off message, recap, risk scan, scope-creep note, tasks-from-doc), metered credits, per-org usage/cost logging, tone + talking-points per client. Competitors' AI is inward-facing (summaries, smart scheduling, forecasting). Verdolo's is outward-facing: it writes the words the agency sends to clients. That is the moat. Extend it, do not dilute it.

**Tasks.** List/board/calendar views, recurring templates with subtasks, multi-assignee, quick capture, doc import, timers, optimistic UI, realtime. This is at or near feature parity with competitors for this segment. Mostly done; only gap that matters is time estimates (needed later for capacity and budgets).

**Time tracking.** Timers, billable flags, target hours per member, archive with totals. Solid. Becomes far more valuable once entries burn down a budget instead of just accumulating.

**Revenue page.** Retainer + hourly + one-off charges, MRR, effective hourly rate per client. Good bones; this is half of a profitability engine already.

**Reports.** Per-client profitability, effective rate, trend charts, team breakdown. Competitive for the segment. Add utilization vs `target_hours_per_week` (data already stored, unused for this).

**Infra you should be proud of:** RLS on all tenant tables with hardened SECURITY DEFINER helpers, rate limiting, atomic AI credits, Stripe billing with trials/seats/lifetime, admin panel, guided tour with replay. This is retention infrastructure; none of it needs V2 work.

### Underbaked: fix or upgrade

**Proposals.** Currently a status tracker (title, amount, draft/sent/signed/declined, external doc link). The doc itself lives in Google Docs. Productive's headline feature is deal -> project -> budget continuity; Scoro's is quote -> invoice. Verdolo's proposal object connects to nothing: signing one does not set the client's stage, retainer, or kick off tasks. As-is it is a spreadsheet column with a nicer UI. Upgrade path in Phase 2.

**Messages.** A full internal chat (DMs, threads, mentions, replies, files) competing with Slack for teams that already live in Slack. High build cost already sunk, low switching value: nobody picks an agency tool for its internal chat. Do not extend it further; repurpose the infrastructure toward client-facing communication (portal comments/approvals) where it becomes a differentiator instead of a clone.

**Integrations.** Settings shows seven "Coming soon" cards and ships zero live integrations. The 0001 schema for Gmail/Slack/Google Calendar inbox sync exists but is dead. A visible wall of "coming soon" actively hurts trust with evaluators. Either ship one (Gmail, see Phase 3) or hide the wall until something is real.

### Dead weight: cut

- **Dead integration schema** (`inbox_threads`, `inbox_messages`, unused `integration_connections` providers): keep only if Phase 3 Gmail reuses it; otherwise drop for hygiene.
- **`is_gcal`/`gcal_id` task columns and `anthropic_api_key_encrypted` on orgs**: vestigial, nothing reads them.
- **PIN lock**: niche; fine to keep since it is built, but never spend another hour on it.
- **Lifetime plan / purchase tokens**: fine for early sales, but it complicates every billing change. Plan to sunset for new customers once subscription traction exists.
- **Invoicing (removed in 0051)**: correctly cut in V1 form (Stripe Connect was heavy). But the need it served is real and comes back in Phase 1 in a lighter form.

---

## 2. The structural gap

Everything in verdolo hangs off a client. Competitors hang work off an engagement (project/budget) under a client. That one modeling difference is what enables their killer features:

- a fixed-fee project that shows 80% of budget consumed at 40% of work done
- a retainer that shows 32 of 40 hours burned on day 18 of the month
- profitability per engagement, not just per client
- a quote that becomes a budget that becomes an invoice

Verdolo already stores the inputs (retainer_cents, hourly rates, time entries, charges). It has the data for burn tracking today; it just has no object to aggregate them against besides the client. Adding a lightweight budgets layer is the single highest-leverage schema change available.

## 3. Competitive picture

| | Productive | Scoro | Teamwork | Verdolo today |
|---|---|---|---|---|
| Budgets & burn | Yes (fixed, T&M, retainer) | Yes | Yes | No |
| Quote/proposal -> project | Yes | Yes (best) | Partial | Tracker only |
| Invoicing | Yes + Xero/QB | Yes | Yes | No |
| Client portal | Yes (free) | Yes | Yes | No |
| Resource/capacity planning | Yes (heatmaps) | Yes | Yes | Target hours only |
| Client relationship health | No | No | No | Yes |
| AI client-facing comms | No | No | No | Yes |
| Automations | Yes | Yes | Yes | Crons only |
| Price floor | ~3 seats, $11-39/u/mo | 5 seats, $28+/u/mo (~$1,680/yr min) | 3 seats, $11-25/u/mo | None |

Two things stand out. First, the gap columns are all the same theme: money and client-facing surface. Second, every competitor has a seat minimum that punishes 1-4 person agencies. Verdolo can price under that floor and win the segment the leaders structurally ignore, then grow with those agencies.

---

## 4. V2 roadmap

Three phases, each one shippable and each one a switching argument on its own.

### Phase 1: the money loop (biggest gap, mostly existing data)

1. **Retainer burn tracking.** Per client per month: hours logged vs retainer value at the client's effective rate, burn %, projected overrun. Surface on Dashboard, Clients, and Revenue. Alert (existing notification path) at 75/90/100%. Already on your ideas list as "budget spend-threshold alerts"; this is the productized version. Feeds the existing AI scope-creep note, which becomes dramatically better with real burn data behind it.
2. **Budgets (lightweight projects).** New `budgets` table: client_id, name, type (fixed_fee | retainer | hourly_cap), amount_cents, hours_cap, start/end. Tasks and time entries get an optional budget_id. No Gantt, no phases, no dependencies; that is where Productive gets heavy. Just "is this engagement making money."
3. **Task time estimates.** One column; enables budget forecasting and Phase 3 capacity.
4. **Invoicing, light.** Do not resurrect Stripe Connect. Generate an invoice record from unbilled charges + hours + retainer, render a branded PDF, mark paid/unpaid, and export CSV for Xero/QuickBooks. That covers 90% of the value at 10% of the complexity that got 0026 removed. Payment collection can come later via a hosted Stripe invoice link.

Result: verdolo can honestly say "know if every client is profitable, and never eat unbilled overage again." That sentence alone is why agencies leave ClickUp.

### Phase 2: the client-facing surface (the switching showcase)

5. **Client portal.** Per-client, branded, token-link (no client login to start): current status, tasks completed this period, hours vs retainer, shared files (client_files already exists), latest report. Read-only V1. Competitors have portals, but theirs are project dashboards; verdolo's is a retainer-transparency page, which small-agency clients actually ask for. This was already on your ideas list as "client-facing status page."
6. **AI client reports.** Extend generate-recap into a scheduled, client-facing weekly/monthly report (work done, hours, results, next steps, written in the client's configured tone), delivered to the portal and/or email after one-click approval. This is the flagship demo: no competitor writes the client's status report for them. It also creates the "sent report" event that updates `last_contacted`, closing the health-score loop.
7. **Proposal upgrade.** Line items, template library, shareable web page with an Accept button (typed-name acceptance is enough at this segment), and on acceptance: client stage -> Active, retainer/budget created, kickoff tasks from the existing default-task templates. That is the deal -> delivery continuity Productive sells, at a fraction of the surface area. AI drafting of the proposal body slots straight into the existing AI credit system.
8. **Portal approvals (later in phase).** Reuse the messages infrastructure for client comments/approvals on portal items instead of building more internal chat.

### Phase 3: stickiness and switching cost

9. **Gmail integration (the one integration that matters).** Match threads by `contact_domain` (column already exists and is indexed), auto-update `last_contacted`, show last-email context on the client. This converts the health score from self-reported to automatic, which upgrades your best differentiator from "nice" to "trustworthy." The 0001 schema anticipated exactly this.
10. **Automations, rules-based.** Generalize the existing crons (contract expiry -> task already ships) into user-visible rules: client enters At Risk -> create task/notify; burn hits X% -> notify; proposal signed -> kickoff. A handful of hardcoded triggers with configurable actions beats a workflow builder.
11. **Capacity view.** Member workload (estimates + logged hours) vs target_hours_per_week as a simple weekly heatmap. Answers "who is over capacity" without Productive-style resource scheduling.
12. **Importers.** CSV import from Asana/ClickUp/Trello/Monday exports (clients, tasks, time). Publish switching guides. Nobody moves without a migration path; competitors all publish these.
13. **Zapier/API (read + create endpoints).** Cheapest way to neutralize the integration-checklist objection for every tool you have not built.
14. **PWA + push.** Desktop notifications already exist; wrap for mobile. Full native apps are not worth it yet.

### Explicitly not doing

Gantt/dependencies, general resource scheduling, CRM-grade sales pipeline, accounting, internal chat expansion, per-integration sprawl. Each drags verdolo toward Scoro's learning-curve problem and away from the wedge.

---

## 5. Why this wins switchers

- **From ClickUp/Asana/Monday:** they need 2-3 bolt-on tools (Harvest/Toggl + QuickBooks + spreadsheets) to see profitability. Phase 1 collapses that stack.
- **From Productive/Scoro:** seat minimums and complexity. Verdolo at no seat minimum with a one-day learning curve undercuts them for teams under ~8.
- **From spreadsheets/nothing:** the AI reports + portal make a two-person shop look like a bigger agency to its clients. That is an emotional buy, and it is unique to verdolo.

Suggested sequencing rule: nothing from Phase 2 before burn tracking ships, because every client-facing surface is more impressive when it can show budget/burn numbers.

## Sources

- [The Digital Project Manager: best agency management systems 2026](https://thedigitalprojectmanager.com/tools/best-agency-management-system/)
- [Teamwork: agency management software 2026](https://www.teamwork.com/blog/agency-management-software/)
- [Productive: Asana vs ClickUp vs Monday vs Productive](https://productive.io/blog/asana-vs-clickup-vs-monday-vs-productive/)
- [Assembly: agency management software tested 2026](https://assembly.com/blog/agency-management-software)
- [The Digital Project Manager: AI agency management systems 2026](https://thedigitalprojectmanager.com/tools/best-ai-agency-management-system/)
- [ActiveCollab: Asana alternatives for agencies](https://activecollab.com/blog/compare/best-asana-alternatives)
- [Agency Handy: Productive.io pricing 2026](https://www.agencyhandy.com/client-portal/productive-io-pricing/)

# cloudflare-worker/src/services — logic, not HTTP

`thesisFit.ts` (D1239) computes personal fit from structured thesis preferences and recorded sector, stage, market-country regions and USD minimum cheque. Missing criteria lower coverage; no fit is stored or used as a venture scope.


`programUsage.ts` (D1156) collects month-to-date program counts locally, sends
only aggregates to HQ, validates authenticated reports and reads dated per-grant
figures. Missing and unreadable metrics stay distinct from measured zero.

Everything a route needs that is not request parsing or response shaping. A file
here takes `env` and plain values; it does not take a Hono `Context` and does
not return a `Response`.

`storagePlans.ts` (D1167, #3080) holds the owner's storage allowances and exact
Best suited for copy. `storagePlanKey` resolves the caller's effective profile,
persona subscription and LP admission (the shared LP reader and one-time
account claim) without summing allowances; failed reads
throw fixed words. `planCatalogue.ts` and the public plans rows project the same
table. Negotiated and staff values stay null with distinct reasons. Later
storage readers and guards must consume it rather than copy figures.

`storageRoom.ts` (D1170, #3083) is the storage guard every member upload calls
before its R2 write, and the 80/95/100% notices sent once the write lands. Its
refusal is the one exception to "never a Response" here: it throws the 413
`storage_full` Response, because the same shape must answer from routes,
record actions and writers alike, and every caller passes a thrown Response
through. `storageHq.ts` is HQ's totals over every member (by kind, plan and
state), from `storageUsage.ts`'s per-owner statements and `storagePlans.ts`'s
`chooseStoragePlanKey`: no second copy of either rule.

`dealAccess.ts` is D1149's shared invited-or-committed investor predicate, used
by the deal reader and diligence opener. A room request is not a grant.

The split matters because it is what makes the logic testable: the worker suite
runs these directly against an in-process SQLite, with no request at all.

`useOfFunds/` holds D1175's pure, versioned plan engine and founder-scoped,
transactional legacy copy/Base writer. See its README for the part-3 contract;
forecasts stay Modelled and never supply runway today.

`bankAccountHistory.ts` (D1182, #3111) reads the masked reveal ledger and
bank-account/Mercury audit history. It uses a successful read audit as its route
gate, validates bound filters, pins append-only source ids for insertion-stable
pages, and never reads/decrypts account-number ciphertext or calls Mercury.
Malformed audit details are flagged per row without disabling the history.
`entityBankAccounts.ts` resolves the recorder's name only for Super Admin
console responses; a missing name stays null, with no id/email fallback.
Shared payment-instruction and notice projections omit recorder names.
D1184 (#3113) validates an optional Mercury source through `mercury/registry.ts`
before inserting a registry account; its entity, last four and kind must agree.

`captableAccess.ts` consumes verified project permissions from the cap-table
router (#2436). Investors receive no project-bound cap-table access; accepted
cofounders may write and accepted advisors may read without holder emails.
Partners require recorded membership. Scenario ownership cannot bypass project
permissions; list responses are owner-scoped, including for admins. Bound
scenarios whose project is missing fail closed for non-admins; admin can recover
or delete them. They are never silently detached into private scenarios.

`scoreAccess.ts` scopes #2439 project risk through existing deal permissions,
and, since D1074 (#2966), trust-score reads to the member, an admin of this
territory (this deployment's database), and a counterparty in an open intro or
deal (`mayReadTrustScores`, `counterpartiesOf`). D1254 narrows investors to a
shared open deal; an intro alone does not grant an investor a trust-score read.
Self/admin trust reads retain
obligation details; a counterparty receives only the bare score. Non-admin risk and
screening snapshots use `scoreIntegrity.ts` verification and read auditing.
Bulk reads deduplicate projects, select snapshots once, and batch per-score
audit entries without weakening approval or signature checks.

D1254 makes both engines in `scoring.ts` ignore reserved adjustments, including
direct service callers. New snapshots retain a zero legacy adjustment field.
Scoring and intake never promote, reject or advance a venture from a score;
status changes belong to a person's separate act. Risk coverage excludes
unscored layers, retaining a recorded numeric zero.

`eventTimes.ts` (D1115, #2995) validates and converts the event writer’s local
clock inputs in the selected IANA zone, preserving explicit instants and refusing
invalid or ambiguous wall times. Its instant comparison keeps formatting-only
normalization out of the changed-after-approval flag.

D1174 (#3101): `raiseCycle.ts` shares the five-section split reader in
`../util/useOfFunds.ts` with readiness, records and decks. The Modelled cash
line injects the raise only at the recorded active-round close month; an
unreadable close read leaves the baseline available. No date is assumed.

`memberFiles.ts` (D1168, #3081) writes measured headshot/brand-logo metadata
with its authoritative key. `memberFileSizeBackfill.ts` measures missing sizes
for five record stores and profile files with HEAD only, using migration 605's
durable pointer/discovery cursors and per-row checkpoints. Missing is marked,
never 0; failures are retryable. Replaced headshots are invalidated with the
new pointer and remain eligible for reconciliation in later passes. Only the HQ Super Admin maintenance route
invokes it, with step-up and count-only auditing. An explicit rescan restarts
completed discovery to recover later retained uploads; an active scan keeps its
cursor. No object content or deletion.

## The ones worth knowing

`segmentMembership.ts` (D1128, #3008) resolves stored segment identities,
the active sign-up catalog, an admin-moved member's missing questions, and the
suppressed per-segment all-question completion count. Questions remain defined
in code. `segmentProfiles.ts` also creates an authored profile and its first
history version atomically. Events resolves its audience IDs from this store.

`personaSegments.ts` is D999's segment counts (#2814) behind
`GET /api/personas/admin/segments`: one grouped pass over every account but
admins (deactivated ones counted apart), folded into blocks that each carry
`available` and `reason`; the LP store, the tag dates and the move log are read
alone, so one failed count never blanks the page. Counts only: no row names or
ids a member.

`meetingBotOperations.ts` implements D886 B10 (#2588): count-only time windows,
complete-measurement financials, strict failure/heartbeat/markup thresholds and
fixed notification copy. `meetingBotOperationsRead.ts` reads B1's canonical
state in complete keyset pages and sums its settled per-block bot fee ledger.
Audio uses final session receipts; STT uses attributed settled aiRouter reservations.
Reused-session audio and unmeasured supplier cost stay Not recorded; canary
prices are ceilings, never measurements. Bot runtime includes waiting and is
separate from transcribed audio. A 25% markup is a 20% gross margin; the alert
fires below 15% markup over seven days, only with complete measurements.

`meetingBotOperationsAlerts.ts` evaluates HQ every five minutes and atomically
writes a dedupe receipt plus the existing in-app inbox item. Active HQ Super
Admins only; their notification opt-outs apply. Repeated/concurrent sweeps
share daily failure/markup receipts and per-run heartbeat receipts. Processing
is excluded from runtime heartbeat alerts. `meetingBotOperationsTest.ts`
delegates the step-up-protected live check to B1's existing dispatch
service with the authenticated actor and reads only the operator's own status-event timings. It never reads
roster, speaker or transcript content. The routes are on `admin_platform.ts`;
no new schema, runtime or billing path is introduced.

| File | Why it matters |
| --- | --- |
| `profileEvidenceBlend.ts` | D592's bounded skill-level blend and audited default-off settings read; snapshot versions name the switch state. Only the Super Admin writes through `profile_evidence_blend.ts`; the owner activates it after the synthetic comparison. |
| `interviewStructuring.ts` | D658: an interview transcript turned into Validate placements. The kinds with a schema each (seven, and since D757 §2.6 (#1923) seventeen, each with its MCP module string and its cycle `slug`; `placementSlug` reads a kind that spans two modules by its payload), the rule that a placement without a cited span is dropped, splitting a long transcript without cutting it, Ask's citation check, and Compare's alignment by module. A pain may name one of the founder's themes, never a new one (D757, #1897). Since D757 (#1923) structuring runs as two passes (`STRUCTURE_PASSES`: A, the problem, the person and the market; B, demand and evidence), each call with `PASS_MAX_TOKENS`; pass B refused keeps pass A's placements and returns `passBRefusal`, which the engine turns into its note. |
| `conversationItems.ts` | D859 (#2504): a customer chat's data points (price, spend, frequency, current tool, team size, pain), actions (follow-up, intro offered, beta sign-up) and prototype asks, extracted after a chat's structure stage and stored as `validate_proposals` placements on existing kinds plus `follow_up` and `prototype_ask`, so Accept writes through the module's own writer. Consent first, every item cites its passage, an amount is kept only when the figure is in the quote, below `MIN_CONFIDENCE` a data point is dropped, dedupe makes a re-run propose nothing twice, and each call is metered by `aiRouter`. D873 (#2520): a Zoom, Meet or uploaded call is read too, for two more items, a `decision` and an `action_item` (a `follow_up`), and every run reads D857's translation. |
| `accountNotes.ts` | D1303 (#3400): who saved an account's internal notes and when, over migration 639's `account_note_saves` (`noteSaveStatement` goes in the save's batch; `notesSavedOf` answers the profile read, saying "Not recorded" for notes saved before it). Never the text. |
| `verificationResend.ts` | D1303 (#3400): re-sending an account's verification link (a fresh hashed token, 24 hours, the email best-effort, the `admin_resent_verification` row), shared by the single resend in `admin.ts` and the bulk resend in `admin_accounts.ts`. |
| `apiKeyLimits.ts` | D849 (#2472) part 2: a member API key's own monthly cap and its alerts, with no migration. A key's metered holds are tagged `key:<uid>:exec:…` (`keyHoldKey`), so `keyMonthSpend` sums its own rows in `ai_budget_reservations` (pending and review at what they hold, settled at what they charged, refunded at nothing). `meteredCall` refuses with `key_limit_reached` before the hold and again after it. `noteKeyLimitThresholds` (`api_key_limit`, 80% and 100%) and `noteKeyFailures` (`api_key_failures`, more than 20% of at least 50 calls in an hour) notify through `notify()`, once per window, deduplicated in `RATE_LIMITS`. |
| `metering.ts` | D844 (#2466): metering on the one AI token ledger. `METERING_POLICY` (versioned) prices each operation in integer micro-USD; v1 lists every MCP tool at 0. `quoteFor` quotes from the policy only; `meteredCall` holds through `reserveAiBudget` under `exec:<execution id>:<component>` (migration 525's idempotency key; `key:<uid>:exec:…` for a call through an API key, whose own cap it checks, D849), runs, settles at the provider's reported cost or the quote, and releases on a throw, timeout or cancel. `REFUSAL_WORDS` says the ledger's refusals in plain words, with no amounts. The failure table is in D844.md. |
| `flows.ts` | D853 (#2476): multi-connector flows on JOB_QUEUE. Recipes are code constants (trigger → read → map → proposal → accept → publish → result); runs and step attempts are in migration 526. Each attempt holds through `meteredCall` under `flow:<run>:<step>:<attempt>`, writes its output before the hold settles so a crash never charges twice, and is leased so a duplicate message is a no-op. A proposal stops at `waiting_accept` until `acceptFlow`; `cancelFlow` releases the run's pending holds; scope (member, company, connection) is re-checked at every step. The crash table is in D853.md. |
| `mercurySpend.ts` | D752: a founder's months, burn, cash and runway from their own Mercury lines. Pure, no SQL; financing never lowers burn. |
| `interviewFindings.ts` | D757 §2.6 (#1923): the findings no Validate module table holds (`firmographic`, `job_to_be_done`, `market_fact`, `alternative`, and the demand kinds `budget`, `timing`, `urgency`, `buying_trigger`, `objection`), each with its parse, dedupe key and module, pure so the structure step, the MCP tool and the writer hold a payload to one rule. They land in `interview_findings` (migration 489) through `validateWriters.ts`'s `writeInterviewFinding`, which upserts on `(interview_id, kind, key_norm)` so a retried accept is one row. `presentTables` lets the §2.13 privacy statements (a deleted or withdrawn session clears the findings' quotes; a deleted interview deletes its findings and its interview evidence links) run only where their tables are. |
| `interviewSuggestions.ts` | D757 §2.6–§2.7 (#1925): what a Validate module reads from interviews, reads only. `moduleSuggestions` is a module's pending engine suggestions (`parts.suggestions`, writers only), each with its interviewee, session, first transcript segment, speaker and link to the line, the quote withheld without consent; `findingsFor` is the accepted findings the ICP, Market and Demand records list, behind the Quotes rule; `acceptedPerModule` is Customer research's "What it fed". Accept, one at a time or all at once, stays in `../routes/founder_validate_structure.ts`. |
| `eadwynConnectors.ts` | D652's three rules for connectors in an Eadwyn conversation: the read gate (`readableConnectors`: switched on AND active), the sends a run may only propose (`validateSend`, `SEND_TARGETS`), and the one serialisation and SHA-256 of a payload, so confirm sends what was shown. |
| `tenancyScope.ts` | **The one place row-level scoping is decided.** Returns composable SQL clauses (`esignEnvelopeScope`, `fundGpScope`, `lpMembershipScope`) and fails closed — an actor it cannot identify gets `NO_ROWS`, not everything. |
| `stagedSigning.ts` | D1216 (#3213): a closing line's paper signed in order — company, investor, then Axal's countersign — on migration 633's `esign_staged_envelopes` and `esign_staged_signers`. Each stage is a single-recipient envelope sent with `createAndSendEnvelope({ renderedBody })` and checked against the recorded digest; the sign route's completion hook sends the next stage, except Axal's, which a Super Admin releases with step-up. The order is also held by the migration's triggers. A counsel draft previews, never sends. The booklet's `bookletSigning.ts` is unchanged. |
| `signedDownload.ts` | One-time, short-TTL, HMAC-signed R2 download tokens. Every private file download goes through it. |
| `dealPassTaxonomy.ts` | The five pass reasons and the stage-event recorder. |
| `dealStudioLens.ts` | D1242 (#3255): Deal flow's Studio lens read (`GET /api/deals/studio`), who may move a round (an admin any, an Operating Partner only the rounds they lead), and who set a Not raising round so: a person, intake scoring before #2643, or not recorded. |
| `backup.ts` | The nightly D1 export to R2. |
| `fundSheets.ts` | Super Admin fund research ↔ Google Sheets. Dedicated OAuth, never calendar tokens. Founders cannot Connect. |
| `researchFundRead.ts` | The dossier overlap sentence. A missing cheque end stays open; a missing raise is not an overlap of zero. |
| `researchTaxonomy.ts` | The Research crosswalk (D533, migration 376): which market a company sector label or a fund focus token belongs to, which country a place string means, and each market's market-intelligence sector. Exact-match dictionaries plus hand overrides; every answer carries `method` and `rule`, and a value nothing names stays unmapped — no substring guessing. |
| `googleIdToken.ts` | D722: a Google id_token checked against Google's published keys — RS256 by `kid`, issuer, `aud` and `azp`, the clock with 300 s of skew and a 900 s maximum age, `sub`, and a verified email. The keys are one `createRemoteJWKSet` per isolate under a 3 s timeout, refetched on an unknown `kid`. Returns `hd`; `googleIsAuthoritative(email, hd)` is Google's rule for whether it vouches for the inbox (gmail.com, or a Workspace account), which `resolveGoogleSignin` requires before it links or creates by email. The token check is used by `POST /api/auth/google/popup` only; `/callback` keeps its own checks until the follow-up. Never throws. |
| `securityEvents.ts` | The `security_events` ledger (D200): refusals and step-ups at the auth boundary, subject hashed and network bucketed, one row per minute, 90-day retention sealed by trigger. Never throws — a refusal's own status is never changed by its telemetry. |
| `queueWorker.ts` | `handleJob`, the one dispatch for every queued job type in `../models/jobs.ts`, used by the D1 cron drain here and by `../queue-consumer.ts` for Cloudflare Queues. A new job type needs both a `JobType` entry and a case here, or its messages fail as "unknown job type" (D685's `interview_process` was cast into being without either until S1 registered it, #1584). `AI_JOB_TYPES` is the per-drain AI cap, mirrored in `../queue-consumer.ts` (a test keeps the two equal). `interview_process` stays out of it: on the Cloudflare path a deferral spends one of the message's retries, so the cap would dead-letter a recording's run, which only an admin's manual DLQ retry (`../routes/infra.ts`) replays. The member's D640 budget already bounds that job's AI calls. |
| `deadLetters.ts` | The dead-letter backlog counted once, over **both** of its tables (`dead_letter_queue` and `cf_dlq_mirror`). Read-only, and either table failing makes the whole answer unreadable with the table named — half a sum is never sent as the sum (D202). |
| `platformSwitches.ts` | The switches the platform does have, for HQ Platform (D202) and Switches (D203). **It parses no variable of its own**: each entry calls the predicate its reader calls, because the readers disagree about what "on" means. States only — never a value, never a variable name. `eadwyn_off` is the one with two halves, the deployment's and HQ's, and both are read through `advisorKillState` — the predicate every advisor route calls. |
| `operatorSwitches.ts` | The switch store HQ throws from Platform → Switches (D203, migration 283). **Kill-only**: it can switch a capability off and release its own kill, never switch one on and never lift a deployment's. Read as one 30-second reading per database binding; the writing isolate clears its own reading, a failed read keeps the last good one and retries after the same 30 seconds rather than latching, and with none the store is unreadable — which the gate reads as "not thrown", because a D1 blip must not switch Eadwyn off for everyone. The D1 reads live here and not in `platformSwitches.ts`, whose guard forbids it reading the environment. |
| `supportQueues.ts` | HQ Support's three queues read from HQ's own records (D204). **One definition of an open ticket** — `OPEN_TICKET_STATUSES` and `ticketBacklog`, which HQ Home's Queue backlog reads too — and `personaOf`, which sorts each open ticket by its requester's standing NOW: no account, a closed account, bound in `licence_admins` (the binding beats the role), HQ staff, else an HQ-held user. The licence kind is never read. Every read answers for itself: a failed one is `available: false` with its reason, a read past its ceiling is `complete: false` and its count is withheld rather than shown as the length of a cut list. The GET never runs the sync bootstrap. |
| `escalationConcerns.ts` | What a content escalation can name (D208): HQ's template library as pushed to the branch, and the branch's own newest hundred articles. **One label format**, `concernLabel`, builds both what the drawer lists and what the route stores and sends to HQ, so the two are the same bytes; a long title gives way before the slug does, and the whole fits the 300 characters both escalation tables keep. The list never throws — each source reads in its own try, and an unreadable one is its own state with its reason, never an empty list. A pick is read again at the raise (`resolveConcern`), never taken from the client, and one that no longer resolves is a typed refusal the route turns into a 400 or a 503 before HQ is called. A label names an item; it does not say the submission localises it, which is why HQ's Localised count stays unrecorded. |
| `escalationRequests.ts` | What an Administrator's request to HQ carries (D799): one rule per kind for a renewal, a term change, a seat increase, a delegate and notice of non-renewal, with one sentence for each refusal. Read by the HQ-tier lane, the branch lane and HQ's `recordEscalation`, which checks again what a branch sends. The fields travel in `detail` as `{ v: 1, request, note }`, so no migration is needed and the branch's retry carries them; a row whose `detail` is not that object is plain text and reads back as a note. A field a kind does not have is refused, never dropped; a non-renewal's notice date is set by the door that writes the row. |
| `escalationAnswerNotice.ts` | HQ's answer to a request, in the raiser's bell (D799): one `notify` per decision, `in_app` and `email`, category `compliance`, linking to `/admin/my-licence/requests`. HQ tells an HQ-tier raiser; a branch tells its own raiser when the decision lands, because HQ cannot write the branch's database. |
| `topology.ts` | What a Worker is, stated once per tier (D209, canvases H14 and S14): the bindings each tier declares and what each names (D681's OAuth namespace is HQ-only), both RPC entrypoints method for method with whether anything calls each and whether it takes a secret, what the shared Analytics Engine dataset carries and what it does not, who deploys what, which screens write Worker secrets, and where Cloudflare Access is mounted. **Structural facts are literals** held by `cloudflare-worker/test/topology_d209.test.ts` to the file that decides each — `wrangler.toml`, the RPC classes, the generator, the workflows, `index.ts` — because a deployed Worker carries none of them; **runtime facts** (which bindings are present, whether the SQL credentials are set, where a secret write would land) are read from `env` on the request. Pure over `env`, so it has no store to fail, and it never returns a secret value. Both `GET /api/admin/platform/topology` and `GET /api/branch/deployment` answer from it, so the two tiers cannot describe the architecture two ways. |
| `aiConsumption.ts` | D776 (#2093): a member's own AI runs in a month, grouped by the rail's page, by option within a page, or by record, with what they were charged (`charged_microusd`, D762), and the allowance and token split read once per hold from `ai_budget_reservations`. A NULL charge is counted as Not recorded, never as 0. The member's rows only; `GET /api/ai-budget/runs` serves it. PR 2's `memberMonth` gives HQ the same grouped read for one member, by option within a page, with each run's cost, charge and model; `GET /api/ai-budget/members/:id/runs` serves it to HQ's Admin and Super Admin and audits each read. |
| `aiAutoReload.ts` | D794 (#2219): the `ai_auto_reload` job and the member's settings. `runAutoReload` takes the member's lock (migration 511), checks the reload is still due and `reloadBlocked` (D791: a member HQ paused answers `paused`, nothing charged), judges the pack with `tokenPackQuote` and the member's D788 spend limit (`limitStop`, told once), claims the crossing, creates the PaymentIntent unconfirmed, writes the pending order and its `ai_topup_purchases` row, then confirms off-session; the webhook credits it as any pack. A card failure turns auto-reload off and notifies once (`DISABLED_WORDS`); a Stripe outage hands the crossing back. `saveAutoReload` and `createReloadSetup` serve the `/api/ai-budget/auto-reload` routes; the card is read back from Stripe, never taken from the browser. D806: the pending order's lines carry `origin: 'auto_reload'`, so the invoice list names it as a reload. |
| `aiAutoReloadDue.ts` | D794 (#2219): whether a member's auto-reload is due — on, with a saved card, the balance below their threshold, and the crossing (`crossingOf`, the latest credited pack's payment intent) not yet claimed. Reads D1 only and never throws; `queueAutoReloadIfDue` queues one `ai_auto_reload` job per crossing. Called from `aiBudget.settleAiReservation`, so it must stay free of Stripe code (D707). |
| `redirectRoutes.ts` | #2301: the SPA's redirect-only routes (`REDIRECT_ROUTES`, each exact pattern before its splat, `keep` on the ones an email or external link carries) and `isRedirectKey`, which `POST /api/public/analytics/pageview` checks before counting a `redirect:<pattern>` beacon. The SPA imports it (`frontend/src/lib/redirectBeacon.js`); a frontend test holds its path-only entries equal to App.jsx's redirect routes; D939 adds a separately pinned closed set of historical admin-tab counter keys. |
| `billingInvoices.ts` | D806 (#2245): Billing's one invoice list, for `GET /api/billing/invoices`. `orderInvoiceRows` reads the member's own paid orders, each with its token pack (`ai_topup_purchases`) and the cents refunded of it (the latest `ai_credit_ledger` refund row's `source_ref`); `stripeInvoiceRow` turns a Stripe plan invoice into a row (the plan's name and interval, its credit notes, its `invoice_pdf` passed through); `pageInvoices` sorts newest first and pages. D1 and pure only: the route reads Stripe. |
| `aiUsageAdmin.ts` | D791 (#2216): HQ › AI usage. `platformAiUsage` totals `ai_usage_logs` over a range (7d, 30d or month to date) by day, model, role and plan, as `aiConsumption.ts` sums them (a NULL charge is Not recorded, never 0), and ranks the top 20 members by charged and by velocity. `aiUsageFlags` raises the five abuse flags from `AI_USAGE_FLAGS`, the one block of thresholds. `pauseMemberAi`, `unpauseMemberAi` and `setMemberAiCap` write migration 510's tables with their audit line in one batch; a new pause tells the member once. `searchAiMembers` finds members by exact user ID or a case-insensitive email prefix (at most 50), and `aiMemberDetail` reads one member's month by model and by day with their balance, allowance, spend limit (D788), pause and cap with history. A member is `{id, name, email}`, the owner's ruling of 2026-10-20 (S1 on #2227); each query reads `u.email` by name, and the audit lines keep the user id. `aiBudget.ts` holds `aiPaused` and `memberAiCap`, which the hold and `resolveAiCaps` read. |
| `aiProviders.ts` | D851 (#2474): `runProviderModel`, a run on a model provider's own API (pattern C) on the one AI token ledger. Off unless the provider's switch is exactly 'on' (`AI_PROVIDER_ANTHROPIC`); the page's AI switch; the platform key from the Worker secret `AI_PROVIDER_ANTHROPIC_KEY`, never in D1 or logged. It holds a quote (`providerQuoteMicro`) through `reserveAiBudget`, calls the adapter in `ai/providers/`, and settles through `settleAiReservation` at the provider's reported usage × its printed rates × `memberChargeMultiplier` (`ai/pricing.ts` `usdRatesBilledMicro`), or at the quote with `usage_reported: false` and the `pricing_version` when it reported none. A failure releases the hold. One `ai_usage_logs` row through `aiRouter`'s `recordUsage`. Nothing calls it yet; the guard (D763) comes first. |
| `aiCost.ts` | D787 (#2212): a member's own AI cost per day and per model for `mtd`, `30d` or `prev_month` (UTC): runs, tokens in and out, the non-token units in `units_json`, `cost_usd` (Cloudflare's cost) and `charged_microusd`, grouped by model, page or option, plus `costCsv`. A refused run counts in `refused` only; a guard run under the guard model; a NULL charge as Not recorded. At most 10,000 runs. The member's rows only; `GET /api/ai-budget/cost` and `cost.csv` serve it. D805 (#2243): `totals.by_kind` through `KIND_GROUP` (every catalogue kind placed), `other_models`, `output_not_recorded`, and the CSV's `kind`. |
| `aiCredits.ts` | D755: the AI top-up balance bought as token packs. `TOKEN_PACK_LIMITS` is §16's one constant block; `ledgerBalance` sums `ai_credit_ledger` (migration 486), which must equal `ai_topup_accounts.balance_microusd` for every member. Holds, releases and spends are written by 486's triggers on `ai_budget_reservations`, so `aiBudget.ts` writes no ledger row. `tokenPackForPrice`, `isTokenPackPrice`, `packOnSale` and `tokenPackQuote` decide what a pack is and whether it can be bought: alone, at face value, no promo, within §16's limits. Only the order intent sells one, and only the payment webhook (`aiTopups.ts`) credits it. `orderTopUp` projects the recorded owner-scoped purchase state and current balance for the order receipt; it never credits or fulfils an order. It returns no projection for historical ordinary orders, even when their prices are later adopted as packs; an explicit pack line without a purchase keeps its receipt with an unreadable marker. Today’s catalogue never reclassifies receipts. Kept apart from Perk and Introduction credits: nothing here reads their ledgers. D805: `recentPackOrders` is the one count of a member's pack orders in the rolling window, read by `tokenPackQuote` and by `packOrdersToday` (`GET /api/ai-budget/limit`'s `pack_orders`). |
| `licenceFeeInvoices.ts` | D802 (#2238), with `statements.ts`'s per-stream draw (`StreamShares`, the `platform_licence_royalties` row): HQ's annual licence-fee invoices to a territory licensee (migration 513). `licenceYear` runs a year from the licence's anniversary (`starts_on`); `issueFeeInvoice` issues one per year at the ledger's `annual_fee_cents`, due after D797's payment terms or 30 days, and refuses a second for the year, a licence with no fee, no start date or a status other than active or suspended, and a missing bank account for `territory_licence_fee`. The printed figures are frozen on the row; `feeInvoicePdf` draws D716's invoice paper from them (`fundNotices.territoryLicenceInvoice`). Payments are HQ-entered running totals, never above the amount; a void needs nothing paid and a reason. |
| `paymentsCatalog.ts` | D1010 (#2829): what Payments' catalogue read says, from the D1 mirror only. `catalogChecks` (two products making one plan, a plan with no yearly price, a subscription that makes no card, a price charged every N intervals, a non-USD or a weekly plan price, the publishable key's mode against the account's), `showsOn` (where a product reaches members), `priceAllowance` and `annotateCatalog` (each price's AI allowance, each plan's yearly saving), `membersPerPlan` (live members per price and per family and interval, rows with no price counted apart), and `changePrice` (add the new price, archive the old, archive the new again if that fails). Never a key, only modes. |
| `planAllowance.ts` | D783 (#2124): a plan includes 25% of its price as AI allowance each month. `PLAN_AI_SHARE` is the share; `allowanceFromCharge` turns a charge into whole micro-USD a month, rounded down, a yearly price ÷ 12. `recordSubscriptionAmount` and `markSubscriptionAmountCanceled` keep `member_subscription_amounts` (migration 505) from the subscription webhook, with the price each subscription is charged at since D1010 (migration 572). `planAllowanceFor` sums a member's active member plans (founder, investor, Market Intelligence, advisor and partner; never Registered Agent), falling back to the catalogue's price for a plan with no recorded row. `aiBudget.ts`'s `resolveAiCaps` reads it for every licence but `admin`. |
| `planCatalogue.ts` | D1050 (#2901): the one plan catalogue, read by every surface that names a plan. `PLAN_CATALOGUE` holds each plan key (`founder:free|growth|studio`, `investor:free|plus|professional|institutional`, `advisor:free|pro`, `partner:free|pro`, `other`, `lp_access`, `admin`) with its family, name, tagline, profile colour, the Stripe metadata `aiCredits.planOf` matches (`licence_key`, `matches`), `sellable` and its reason (Investor Plus is not sold, D786), storage and "Best suited for" (D1167's projection of `storagePlans.ts`) and the included lines. **No price is in it**: prices are Stripe's, read from the D1 mirror. `catalogueFields` and `publicCatalogue` are what `GET /api/public/plans-and-packs` sends (the name as `label`: the public read carries no `name` key). `requireTier.ts` and `requireInvestorTier.ts` name a plan from it. |
| `aiCreditReversals.ts` | D755 §8: `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` take a token pack's tokens back, up to the member's balance, recording the rest as `shortfall_microusd`. The share and the balance are read inside the one INSERT that writes the row, so the balance CHECK never fires and racing deliveries take a share once. Acts only on a charge whose PaymentIntent has an `ai_topup_purchases` row; every other charge is untouched. |
| `approvalDecisions.ts` | D1044 (#2892): the decision log and the weekly arrived-and-decided series. `DECISION_LANES` reads each lane's decided rows from its own store (its decide route's columns, or its own event table where the row keeps no decision time), each one literal SQL with the same columns; a lane that keeps no decision time is `recorded: false` with why, never zero. `decidedLog` merges the lanes newest first, 25 a page; `decidedWeekly` gives eight weeks and the Decided this week tile. HQ's lanes only for a Super Admin (`decisionLanesFor`). |
| `hqApprovalSources.ts` | D1041 (#2889): HQ decides — the eight queues only the Super Admin decides (testing programs sent to HQ, learning exercises, features and tasks, payout requests, held AI runs, notice responses, requests from studios, program proposals), each on its own queue's open predicate. Kept apart from `approvalSources.ts`'s `APPROVAL_SOURCES` so a branch's board, backlog total and assignments never read them; `hqLanes` is read only by HQ's glance for a Super Admin. D1132 (#3012) adds the ninth, Program-grant requests (`grants`, D983's three program kinds while open), and takes those kinds out of Requests from studios, so each is counted once. |
| `approvalInbox.ts` | D1132 (#3012): what HQ's inbox read (D1040) lacked for D1038 part 7 — `parseInboxQuery` (search from two characters, lane, group, age band, assigned, sort; a lane the reader cannot see is a bad value), `filterInbox` (on the rows the board read, in memory, so nothing the caller sends reaches SQL), `laneBands` (each lane's split by age band, none for a failed or capped lane) and `LANE_GROUP`, the canvas's groups, held equal to the page model by `approvals_gaps_d1132.test.ts`. |
| `approvalAssignments.ts` | Who is looking at a board item (D470, migration 341). One current reviewer per lane and item, and an event only when this write changes that person. A missing table stays unreadable — it is not "nobody assigned". A reviewer is an active admin. The write does not change a queue's status and does not open a thread. |
| `accountCounts.ts` | D1301 (#3397): how an account is counted, once, for Admin › Insights (`adminInsights.ts`) and Admin › Accounts' overview (`../routes/admin_accounts_overview.ts`): the grouped pass over live accounts (with email-verified and active-in-30-days sums), LPs by profile, deactivated, sign-ups by week and last activity. Counts only. |
| `activeAccounts.ts` | Active accounts per week, defined once for both tiers (D210): `ACTIVE_ACCOUNT_BASIS` (the sentence both pages print), `activityLogged` (which requests the middleware records — `observability.ts` imports it, so the rule and the log cannot drift), `aeLoggedRequestPredicate` (the Analytics Engine WHERE that mirrors it exactly), `ANALYTICS_RANGES`, `weekAxis`, `weeklyKpi` and `loadBranchWeeklyActives` (a branch's own `activity_logs`, grouped by Monday). A week it cannot count is `null` with one of four reasons, never zero, and each week carries its own reason (`gapNotes` names them once per chart). The KPI is the last complete week; its delta is given only when both weeks carry the same set of series and neither holds a series' first recorded request — `partialWeekReason`'s whole-week rule, which the benchmark median's input and a branch's own figure beside it also read (D211). |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | The advisor state machine and its question banks. |
| `ai/` | D761: the AI router's request and response shapes, per-class timeouts, context-window and paid-only fallbacks, session affinity and the units each attempt used. D760: `catalogue.ts`, every Workers AI model priced in each unit Cloudflare bills, and `pricing.ts`, cost and billed in exact decimals with `AI_MARKUP` written once. D763: `guard.ts` holds Llama Guard's slicing, verdicts, category policy and refusal copy. Pure; `aiRouter.ts` calls it. Its README has the rule for adding here. |
| `calendar/` | Calendar sync (`sync.ts`), cancellation-time removal of tracked copies (`cancelEvents.ts`, D1131), and My events in the calendar (`myEvents.ts`, D1033): tickets and hosted events as calendar kinds, the add-to links, and the copies a sync must remove. D1131 uses `queue.ts`, `queueWorker.ts` and `../models/jobs.ts` for two immediate copies, scan batches of five plus continuation, per-copy cancellation rechecks and independent retry/dead-letter handling. This idempotent job alone may fall back to D1 after an uncertain CF send; exact reads use the mapping primary key, scans use existing source/event indexes. `feedTokens.ts` (D1033, migration 603) is "Subscribe to my events": the per-member token, stored as its SHA-256 only, that lets a calendar client fetch the my-events feed with no session; D1209 (migration 610) adds the whole-calendar scope. `syncState.ts` (D1209) is what a Google or Outlook sync leaves behind: the error code on the token row that the status reads return, and the marker of whose copies a disconnect kept (`calendar_sync_retained`). `sync.ts`'s `removeProviderCopies` is the disconnect's "Remove the copies first". `investorMeetings.ts` (D1190) is the `investor_meeting` kind: a founder's meeting or call with an investor, logged with a start in Capital relationships. |
| `channels/` | D684: business Telegram and WhatsApp conversations, and Zoom and Google Meet calls, reaching Validate › Interviews. The contract, event dedupe, connection tenancy, link codes, outbound tracking and the pending-thread store. Its README has the rules. |
| `decks/` | Deck assembly and export. |
| `email/` | Transactional mail. |
| `fills/` | "AI fills the blanks" — the fill-kind registry and the provenance of an accepted fill. A `sourced` fill carries a citation or it is dropped. `neverFill.ts` lists the fields Eadwyn never fills (D777), mirrored by `frontend/src/lib/neverFill.js`; propose, accept and `recordFill` each refuse one. D1325 (#3486): `fields.ts` is FILL_FIELDS, which form fields Fill with Eadwyn may fill, how and from where (mirrored by `frontend/src/lib/fillFields.js`); `sources.ts` is FILL_SOURCES, the read-only adapters the sheet gathers; `provenance.ts` adds migration 643's source columns and `marksForRows`. D1326 (#3487): `formRun.ts` is the `form` handler's gather, prompt and parse; `keep.ts` records what a form's Save kept, Accept all for row proposals, and undo. |
| `apiUsageReport.ts` | D845: a member's own usage reports over `api_usage_events` (D843). Every statement is `WHERE e.user_id = ?` from the session and joins only the same user's hold; a `key=` is re-checked by `ownsKey`. Grouping is a bound `CASE ?1`, never a spliced column. A charge is the settled hold's, else the row's own, and stays NULL when unknown. |
| `railProposals.ts` | D780: `ai_rail_proposals` (migration 506), what a rail option's run leaves for the member to decide. `proposeRail` stores a draft, proposal or note with the run's page, option, record, model and `usage_log_id` (refusing a field D777 never fills); `decideRail` is the member's accept, edit or discard, once and on their own rows only; `listRail`, `getRail` and `withdrawRail`. Every option outside Validate and the zone drafts writes here. |
| `narrative/` | D908: the Investor narrative's sections, positioning and bound figures, and the compare of two versions, behind `/api/cycles/raise/narrative/*`. Its README has the rules. |
| `market_intel/` | Sourcing, extraction and scoring for market intelligence. |
| `fundAdminAccess.ts` / `fundAdminOverview.ts` | D1159 (#3066): Admin-tier fund creation and valuation acts, with existing institutional GP scope preserved; independent submitted/applicant-signed/not-yet-sent booklet counts per administered fund. Distribution preview LP names come from the shared LP selection in `fundDistributionSplit.ts`, without changing its arithmetic. |
| `closings.ts` | D1215 (#3212): a closing as a record over migration 612 — `closings`, `closing_lines`, `closing_evidence` and the append-only `closing_events`. An admin or the venture's founder reads every line; anyone else only through a line of their own, and then their own lines and the round's total. A line is `received` only on receiving-side evidence; every write appends one event in its own batch, with no amount, name or account number. The operator's runbook is `documentation/operations/CLOSING.md` (D1220). |
| `companyReceivingAccounts.ts` | D1217 (#3214): a company's versioned receiving instructions on migration 613, encrypted with the column cipher; masked reads, the founder's save, an investor's logged 30-second reveal (the ledger row is written before decryption) and the account-change notice. Moves no money. Its router, `../routes/company_receiving_accounts.ts`, is mounted at `/api/closings/company-receiving-accounts` (#3214), and no page reads it yet. A reveal needs D1215's signed line: the commitment's line on an open closing, its own envelope completed and signed by the investor. Also the sender-only Mercury report: an accepted match records Sent on the commitment and, when the commitment has an open line, as `investor_mercury` (sending) evidence on it, so the line reads Sent, never Received. |
| `capTableClose.ts` | D1021 (#2858): a Raise close's investors as proposed issuances on the cap-table record, keyed `raise_prospect:<uid>`. Its header expects the Closing room's CP11 to decide the same row by the same key. That link is not built (D1218 §4): a closing records its own decision (D1215), and the holder is written by the cap table's own path (#2432). |
| `reportFigures.ts` | D1059 (#2929): `REPORT_FIGURES`, one registry of the figures a report carries (Share an update's five keys and migration 168's KPI rule keys mapped onto it, each with its Grow module, sources and unit); `assembleReport` reads every module's stores for a venture and period, each figure with its source and `as_of`, nothing missing read as 0, a Mercury figure team only; the founders' choices, the canonical frozen list and its SHA-256, and what a reader outside the team is shown. |
| `publishSources.ts` | D1333 (#3481, part 2 of #2400): what a founder's publish draft is built from. `DRAFT_BUILDERS`, one per Grow place (`PUBLISH_MODULES`), each reading only the fields `../integrations/publishSources.ts` lists for its stores; every line keeps its source and date, and `sourceChip` names the draft's origin. The never-list: no customer's, applicant's or interviewee's name or contact, no partner's name, no team-only figure (Mercury's, or a bank figure) unless ticked, no 0 for a missing figure. `prefillDraft` and `createDraft` fill `POST /api/publish/drafts`; `publishPart` is a Grow page's Publish to… gate, PUB8's empty states and its last three sends. Sends nothing. |
| `reportingDuties.ts` | D1058 (#2928): reporting duties over migration 579 — `INFORMATION_RIGHTS` (the templates' information-rights clauses), `createReportingDuties(closingId)` called by `completeClosing`, the period arithmetic, `periodState` (late and missing worked out on read, never stored), reminder settings, and `runReportingDaily` (duties a closing missed, periods as they end, the team's reminders, each claimed once). No event holds a figure. |
| `articleMetrics.ts` | D1294 (#3390): the Content queue's Authors and Performance reads over migration 637 — `countDailyView` (one row per article per UTC day on the public read, no personal data; an admin, the author and an impersonated session are not counted), `recordFollowerReach` (counts only, per publish), `authorsRead` and `performanceRead` (views null before the first daily row, never 0). |
| `fundAdminLps.ts` | D1158 (#3065): `GET /api/fund-admin/lps`, every LP of every administered fund in one table. Money from the call ledger (`readFundCalls`), paid distributions, the last D716 notice and the booklet through the LP's application. Writes the fail-closed `fund_lps_read` audit row first. A figure no store holds is null with its reason in the row's `unavailable`; a store that cannot be read makes only its own figures Unreadable. Filters, search, sort, pages and totals run here, after the bound read. |
| `fundPositionsHistory.ts` | D1158 (#3065): `readFundPositions`, each position with its latest dated mark or `marked: false` and a reason; `readFundHistory`, `readFundPerformance` point in time at each quarter end since the first call. Computed on every read, never stored. |
| `mercury/` | D710: Mercury for fund administration, read-only. A GET-only client, the boundary parser that drops account numbers, the gates and read audit, the entity connections' store, the hourly sync and the reconciliation matches. Its README has the rules. |
| `notion/` | D1085: a founder's own Notion, read-only, through Notion's MCP server. `reads.ts` is the only file that opens a Notion session: search, a page with its fingerprint, children, a data source's schema and its rows, each id checked before it is sent, never SQL. Its README has the rules. |
| `referrals/` | Referral submissions. |
| `records/` | D690's scoped cycle record contract, registry and ownership checks. |
| `testingOverview.ts` | D1196 (#3146): Product testing's overview read behind `GET /api/admin/testing/overview` (Super Admin): applications and picks per Monday week from `testing_events` (not recorded before the first programme opened), the tester pool and open programmes' applicants by profile, withdrawn counts, and Mail reach per open programme on `testerRecipients`' rule. Each block answers alone; counts only, never an address. |
| `scoring/` | D1143 (#3029): the Product-market fit score, defined once (#2433). `pmf.ts` is model v1 as data and the pure `scorePmf` (value, band, confidence, coverage and the next steps ranked by gain); `pmfCollector.ts` reads Validate's stores for it with bound SQL, after the latest Pivot, and reads no interviewee name or quote. D1144 adds `pmfStore.ts`: signed, change-only snapshots, history and the atomic PMF checklist/audit update in shared migration 598. See `scoring/README.md`. |
| `ventureScoring/` | D1255 (#3278): the venture scorecard engine for #2428's other ten scopes. `model.ts` is model v1 as data, `engine.ts` the pure `scoreScope`, `collectors.ts` one bound collector per scope (personal inputs aggregated, never-inputs unread), `store.ts` the recompute on read that keeps a signed row per scope only on change in migration 598's store (`state` from 625). PMF stays `scoring/`'s. See `ventureScoring/README.md`. |
| `companyMembershipEvents.ts` | D1137 (#3017): the membership audit, `company_membership_events` (migration 597). `membershipEvent` returns the bound INSERT for a join, role change, removal, leave, primary-admin transfer, archive, restore, rename, venture move, owner transfer or seat change, so the route batches it with the change; before and after hold the fields the change touched, never a token or an email. |
| `signals/` | Signal ingestion and evidence. |
| `vercel/` | D1096: `api.ts`, the only caller of `api.vercel.com`: a read-only client for the planned reads, uninstall and the OAuth code exchange. Its README has the rules. |
| `wellbeing/` | Wellbeing check-ins. |
| `productTesters.ts` | D1042 (#2890): the product tester store (migration 576). `TRANSITIONS` (approve, decline, pause, resume, remove and the status each needs), `messageFor` (what the member is told), `listTesters`, `testerDetail`, `isAdminAccount` (admins cannot test) and `applyTransition` (one conditional UPDATE and one append-only event row in a batch). `reapplyAfter` is the decision day plus 90 days. D1132: a removal ends the member's open program places in the same batch (`withdrawn`, with a `place_ended` row in `testing_events`), never in a closed or rejected programme. `../routes/admin_product_testers.ts` is its only caller. |
| `subAccounts.ts` | D1302 (#3399): an account's sub-accounts, read where each lives — `accountSubAccounts` (the tester row and its events; the LP applications, `is_lp` once one is approved) and `subAccountCounts` (testers per status, LPs counted once, LP applications waiting). Each block is `not_set_up` or `unreadable` on its own, never a 0. No second store. `../routes/admin_sub_accounts.ts` is its only caller. |
| `testingLogo.ts` | D1199 (#3149): a product-testing programme's logo. `checkLogo` sniffs the bytes (a PNG by its signature and IHDR, an SVG by its first element), caps the size (`LOGO_MAX_BYTES`), requires a square, refuses an SVG with script, a handler, a `javascript:` or external link, `<foreignObject>` or a DOCTYPE, and stores any other SVG as the brand route's `sanitizeSvg` rebuilds it. `putLogo` and `removeLogo` go through `testing.ts`'s `ownProgramme` and only while the programme is editable; the key `testing-logos/<uid>/<uuid>.<ext>` in `FILES` is the Worker's alone. `readLogo` serves only that prefix, to the owner, Super Admin, or any member once the programme is open. `../routes/testing.ts` is its only caller. |
| `programGrants.ts` | D982 (#2773): program grants. The nine programs and their readiness (held equal to `frontend/src/lib/programGrants.js`), `TERM_FIELDS` (which grant terms apply to which program, and which are defaultable), `validateTerms` (an unknown or inapplicable term is refused; `null` clears), `presentGrant` (the in-force rule and what a grant waits on), `readGrid`, `readDefaults` and `readHistory`. The store is migration 553; `../routes/admin_program_grants.ts` and `licencePrograms.ts` call it. D983 adds the grid's requests tile and series. D956 adds the `draft` state (migration 562), `programNamed` (the nine or a registry key), the terms every program carries for a program D955 added, and `openDraftStatements`. |
| `programGrantStates.ts` | D956 (#2789): what each viewer reads of a program's grant (`grantViewerOf`, `grantStates`): a Super Admin's count or HQ only, a deployed studio's licence state in the canvas's words (`requested` from both request lanes), the held mode for an admin with no licence or an undeployed studio, and a branch's state from D984's copy; a failed read is unreadable, never a state. Also Offer to studios (`offerToStudios`, `offerRefusal`: D982's switch, on only with a published playbook). Callers: `../routes/admin_programs.ts`, `programCatalogue.ts`, `../routes/admin_program_grants.ts`. |
| `licencePrograms.ts` | D984 (#2775): the Administrator's programs. `programCopy` (the licence's grant rows and which programs HQ grants, as the licence push carries them to the branch, migration 554), `parseProgramCopy`, `studioPrograms` (the nine programs in the studio's words, in force by `presentGrant` and the day) and `unlinkedPrograms` (HQ runs every program). Callers: `../routes/licence_programs.ts` and `licencePush.ts`. |
| `programGrantsHistory.ts` | D1126 (#3006): HQ's History tab, every licence's `program_changed` events newest first a page at a time (`readAllHistory`), and Download CSV, one row per studio and program with every term in its own column (`exportCsv`). Read by `../routes/admin_program_grants.ts`. |
| `programRequests.ts` | D983 (#2774): the program requests checked against HQ's grants where HQ records them (`checkProgramRequest`: offered, held, a term that applies, one open request per question, what the term stands at read from the grant), the open-request counts per lane, a request's licence, and the draft an approval leaves (`draftOf`). Called by `../rpc/hqOps.ts` and `../routes/admin_program_requests.ts`. |
| `trustContent.ts` | D1075 (#2967): the public trust center's content store (migration 584): the seven blocks, each line a fact or a gap with its reason (`parseBody`), a certification only with its auditor's report on file, Publish in one batch with one change note (`publish`), the subprocessors (ten days' notice), the change log, and the public matrix from `trust.ts`'s `obligationsForRole` (`publicMatrix`). |
| `subprocessorNotices.ts` | D1075: the subprocessor notices: double opt-in (an encrypted address, a hashed single-use confirm token), a signed unsubscribe link that works once, and the sweep that emails confirmed subscribers once per new subprocessor before it starts. |
| `securityReports.ts` | D1075: Help's Security category: a member's report, encrypted, read only by HQ's Super Admins and its sender, never a ticket row (tickets mirror to GitHub and Slack). Five a day; HQ only. |
| `kycCase.ts` | D1229 (#3237): one person's KYC case beyond its status (migration 614): the people queue (`readQueue`, its filters, sort, paging and counts per status, every statement static), the case's history (`recordEvent`), the member's notices (`noticeMember`), the figures (`readFigures`) and the hand-off from an expired `kyc_v1` (`expireKycFromObligations`, called by `trust.ts`). |
| `licenceTerms.ts` | D797: a licence's terms schedule, the one list of its 31 fields (`LICENCE_TERM_FIELDS`: key, group, label, type and range) and the canvas's section numbers (`DEFAULT_TERM_SECTIONS`), `validateTermsBody` (an unknown key or a bad value is refused, naming the field; `null` clears), `termsFromRow`, `readLicenceTerms`, `termsDiff` and the `TERMS_REASON` sentences. Migration 512's CHECKs hold the same ranges; HQ's write, `/licence/mine`, the branch copy and D800/D801 import it. |
| `eadwynTools.ts` | D854: Eadwyn uses the MCP registry's tools inside the member's own access. `eadwynToolInfo` lists them (scope and the page's company; D846's filter replaces `eadwynToolAvailable`), `runEadwynToolCalls` re-checks each call the model proposed, runs a read through `callTool` (metered by D844) and turns a write into an `ai_rail_proposals` row, and `toolResultsForModel` hands results back as escaped data. |
| `deckCheck.ts` | D900 (#2679): the deck's check on top of D1264's: Stale from a version's stale bindings (display only), PD13's view (both figures and sources for the founder, states for anyone else), the per-version summaries, and `swapFigure`, which moves only the number the check's patterns read. |
| `raiseClaimNotes.ts` | D900 (#2679): "Keep mine, with a note" on a Mismatch (migration 645). The state stays Mismatch; the note applies only to the figure it was written against. One cycle row under the claim's module, never the note or a figure. |
| `raiseClaims.ts` | D1264 (#3287): the claim check. Every Raise claim (narrative and deck figures, Traction proof, Team and Product-market fit, use-of-funds sections, founder holdings, capital-model assumptions) gets Backed, Founder's figure, Mismatch or Not backed from the pinned evidence, best source first; it writes `raise_claims` and their `computed` links, never a person's link. |
| `raiseEvidenceSources.ts` | D1263: local Raise evidence source registry, safe projections, source dates and snapshot hashes; founder decisions remain in raiseEvidence.ts. |
| `capRelAccess.ts` | D1191 (#3125): capital editor access, local staff counts and mandatory founder-visible support audits; contract in the decision file. |
| `raiseProspectWriters.ts` | D1191: narrow canonical legacy prospect create/edit/promotion writers, re-exported by the Raise writer and safe for Contacts imports. |

## Rules

`cycleCards.ts` defines the D656 Figure and Card shapes, card failure isolation,
and shared paging. `buildCycleRecords.ts` holds D662's D661-shaped record table,
chart specs and bounded search/filter/sort/paging for the Build modules.
`buildCreates.ts` (D1064, #2934) holds Build's three creates (feature, must-have,
roadmap item) as statement builders, each INSERT first with `RETURNING id`, so
a route answers with its own row (`createdId`) and another writer can batch them.

- No `Context`, no `Response`. If you need one, the code belongs in `routes/`.
- Never build SQL by interpolation. `check-sql-prepare` fails the build on a
  `${}` inside `DB.prepare(...)` unless it is a provably safe fragment, and
  every exception is written down in a baseline.
- Fail closed. A rate limiter or a scope that cannot decide must deny, not
  allow — both have been fixed here after doing the opposite.

D647 (#1441): `contractListQuery.ts` validates paging/search/sort and supplies literal picker searches, null-last sorting and stable union tie breaks. See `documentation/architecture/decisions/D647.md` for route/read contracts and access gates.

D647: `contractPublication.ts` reads migration 434's approved template snapshots,
prepares validated documents from those snapshots, and publishes with an actor
audit in one batch. It never infers publication from draft activity or bootstraps
migration 434 at runtime.

D654/D686: `updateShare.ts` holds Grow › Share an update's rules for `../routes/portfolio_updates.ts`:
metrics from `project_metrics` with source and date (a missing one is null, never 0;
growth needs MRR in the prior calendar month), sourced highlights and lowlights,
and Eadwyn's draft through `aiRouter` (`AI_SURFACE.growUpdate`) from metrics and
shipped roadmap or feedback facts. A role or contact alone yields "nothing new".
The audience defaults on for investors, team and network. Network readers get
asks only unless metrics are included. Ask labels use the Grow module names:
Team expansion, Distribution, Partner network, Market expansion and Capital
relationships; stored link keys remain unchanged.

D659 (#1472): `cycleCards.ts` is the shape every cycle read returns: `Figure`,
`Card`, the five states, and `safeCard` / `safeFigure`, which turn a thrown
source into that one card's `unreadable`. Build, Raise and Grow import it.
`cycleFocus.ts` (D692, #1701) is the phone root's shape every overview read returns (`focus`, `meter`, `index`), its helpers (`part`, `sentence`, `cardFocus`, `cardValue`, `usdShort`), and Build's, Raise's and Grow's parts (`buildPhone`, `raisePhone`, `growPhone`).
`validateFocus.ts` (D685 §5.12, #1584; D692, #1701) is what Validate's overview leads with on a phone, in `cycleFocus.ts`'s shape: the focus (record the first conversation; for a writer, review the newest session, counting the pain themes and hypotheses its pending placements would move, else record the next conversation with the meter in the why; for anyone else, the first card's next), the interviews meter against `interviews_month_target` with its `display`, and the index rows, Verdict only for a decision reader. `indexCountsOf` stays as Customer research's two counts, which `../routes/founder_profile.ts` also reads.
`cycleValidate.ts` computes Validate's figures, cards and records from records
at read time and stores nothing. `validateWriters.ts` has one writer per
migration 440 record. The manual routes and #1471's interview accept path both
call it, and each writer records its actor.
`verdict.ts` (D693, #1702–#1704) is the one module that reads and writes Validate's decisions, with the evidence each rests on and its commitments (migrations 211 and 464): the writer `recordDecision`, the readers `currentDecision` and `decisionsFor`, the Verdict card (`verdictCard`, with its Next on `hypotheses.deadline`) and the Decisions table (`decisionRecords`). `cycleValidate.ts` registers both as the seventh module. Since D757 (#1925) the card adds one read-only line, `interview_evidence` ("n new pieces of interview evidence since your last decision, m contradicting"), from `interviewEvidenceSince`, which Record a decision's form-options reads too, as `evidence.suggested_evidence`; nothing on that path writes a decision.

D664: `cycleCards.ts` holds the read every cycle shares (D656, #1469): the card
states, the `Figure`/`Card`/`Records` types, `settleCard` (a failing source makes
only its card unreadable) and paging. `growCycle.ts` computes the Grow figures
and seven cards for `../routes/cycle_grow.ts`. `revenueMovements.ts` splits the
revenue ledger into new, expansion and churned by month (only when customers can
be told apart; churn needs two billings) and rewrites `revenue_movements`.

D1150: `raiseCycle.ts` also owns the stored-receipt projection `receivedCommitment`: investor/commitment owner/company checked, only receipt id/time returned, no bank fields or provider read. It stays beside D752’s `receivedDates` boundary.

D663: `raiseCycle.ts` computes the Raise figures, seven cards and records, plus D686's independently readable, project-scoped Calls history, for
`../routes/cycle_raise.ts`, including the computed readiness checks, the
diligence checklist and the narrative consistency check (fixed patterns, no
model). Since D691 (#1699) each list carries the canvas's title, columns,
filters and default sort (the first in `sorts`), and its row ids are addresses
that never hold a name: an item key, a version, a link, file or prospect id, a
cap-table `h-<n>`, `e-<n>` or `pool`, and a use-of-funds section key.
D1262 (#3285) names the last complete month's revenue sources and each source's
metric snapshot; typed traction stays stated. Team backing reads founder/vesting
and scoped GitHub counts beside the manual assessment. Room opens count only
open_room/download. Capital exposes separate received/wired/signed/soft totals,
using confirmed receipts for received; runway prefers a Connector record and
keeps its source and date. The later Evidence pack and investor projection are
separate tasks.
`capRelReads.ts` (D1190, #3124) is Capital relationships' Commitments
and Match reads: one commitments read across typed prospects, round-call
answers, deal-room commitments and the founder's Mercury matches, each investor
counted once by their strongest line; and the fund directory with each fund's
Fit, the caller's own warm paths and a count of verified investors who fit.
`capRelTabs.ts` (D1193, #3127) is Capital relationships' Outreach, Activity
and Eadwyn's proposals: every logged change across investors, the materials
each investor was sent (the data room for its owner alone), and two metered
runs (next steps and stage moves from a note, each beside its quote; a message
for the founder to send) kept as `ai_rail_proposals` and accepted through the
one prospect writer. Eadwyn never writes an amount, a status or a Fit.
`raiseWriters.ts` has one writer per migration 442 record and, since D691
(#1700), one behind each Raise Add and Edit form (migration 463's stores)
and one per record action: `duplicateNarrativeVersion`, `revokeDeckLink`,
`addSectionHire`, `logProspectEvent`, `addProspectFeedback` and
`markProspectPassed`. Each checks every id it takes against the venture and
logs one row per record it writes through `cycleActivity.ts`'s
`logCycleWrite`.
`capTableWrites.ts` (D691, #1699) is the cap table's one save, `saveScenario()`,
which `POST` and `PUT /api/captable/scenarios` call: the one-per-venture upsert,
its unique-index recovery and D632's activity row, plus an `e-<n>` key on every
founder, SAFE and round entry, matched by name and never reused, which the Raise
list reads as the holder's id. It also holds `addHolder()` and `updateHolder()`
(D691, #1700): Founders · Common writes a `cap_table_holders` row (and its
vesting row, on the same `user_id` and `holder_id`) and returns `h-<id>`;
Investors · SAFE or note adds a `safes[]` entry and returns its `e-<n>`. Both
refuse a caller below `studio` with `ensureTier`'s 402, recompute through
`saveScenario()`, and log nothing themselves. Since D1020 a vesting row also
carries the holder's venture, and `updateHolder()` refuses a Carta
(`connector_carta`) holder: Carta is the record while connected.
`capTableRegister.ts` (D1020, #2857) reads the recorded register of one venture
or of one account: holders, securities, option pools and vesting. Its totals are
`knownSum`, which is null when any row lacks the figure. It also writes the
register's CSV and the "As of" PDF snapshot, and the audit row every export
writes.
`captable.ts` keeps financing reserves in dilution but excludes unallocated
option-pool shares from exit payouts (#2446). Pre-round capped SAFEs choose
purchase amount or cap/basis-based conversion; cash-out SAFEs leave liquidity
capitalization and insufficient cash is prorated, with exact integer-cent
allocation. Exit values must fit safe integer cents; SAFE amounts and caps must
be finite. A pre-round ledger with no positive finite issued shares is withheld.
Unrecorded note or uncapped liquidity terms produce no waterfall plus a warning.
Scenario inputs do not record individual option grants, which the payout
assumptions state. Mercury's accepted SAFEs explicitly pass `post_money` through
`capTableWrites.ts`; manual missing basis retains the legacy pre-money default.
D966 (#2630): `mercury/safeBasisRepair.ts` adds `post_money` to the SAFEs Mercury's Accept wrote before
#2629, through the owner's dry-run-first admin route, and leaves every manual SAFE's default as it is.
The [YC post-money user guide](https://bookface-static.ycombinator.com/assets/ycdc/Website%20User%20Guide%20Feb%202023%20-%20final-28acf9a3b938e643cc270b7da514194d5c271359be25b631b025605673fa9f95.pdf)
explains exclusion of cash-outs and the unissued pool from liquidity capitalization.
`dataRoomActivity.ts` (D1105, #2985) is the data room's activity and checklist
reads: `activityRead()` (a period's daily figures against the period before, per
investor, the paged log), `activityCsv()` (the same rows; 413 past 10,000) and
`checklistRead()` (per diligence item, its files and how many grants in force can
open each, by `tierAdmits()` with each grant's folder scope and the NDA gate). A
refusal (`blocked`) is never counted as an open, and a reader is named only through
one of the venture's own grants. Its routes are `../routes/data_room.ts`'s.
`dataRoomAccess.ts` (D691 decision 6, #1700) is the data room's one access
predicate, `tierAdmits()`: a file's `access_tier` (`invited`, `committed`,
`nobody`) and `access_expires_at`, with `investorCommitted()` (a committed
prospect of the venture, by email) and `admittedCounts()`. Every read outside
the founder's (the investor room, `research.ts`, the advisor brief) decides
with it, so a hidden file is never listed, counted or downloaded.
D1103 (#2983) adds a grant's folder scope (migration 594): `grantFolderScope()`
reads it as the named folders with their subfolders, or null for every folder,
and `tierAdmits()` takes it as its fourth argument. A scope that cannot be read
opens nothing.
`dataRoomRequests.ts` (D1104, #2984) is the access-request queue (migration
595): `roundCallRequestStatement()` (the round call's request, in its response
batch under its claim), `dealPageRequestStatement()` (for DEAL's DL9) and
`readRequests()`. One open request per investor and venture, and none for an
investor who already has the room.
`deckSlideDwell.ts` stores a share-link view's seconds per slide, bounded so
they never add up to more than the view's read time.
`peerBenchmark.ts` (#1524) is the peer-group benchmark for every founder:
the Lab cohort at the week for a member, else every venture at the same
stage, with D589's verified-run rule (`latestVerifiedByFounder`, which the
cohort route also uses). Only the group's size and percentiles leave it.
`narrativeFix.ts` (#1524) hands one stored mismatch to the
`raise/narrative-fix` draft band and holds the wording to it: a draft quoting a
figure the check did not find is refused, and every kept one ends with the
check's own sentence.

D657: interview sessions, for `../routes/founder_validate_sessions.ts`.
- `interviewSessions.ts` holds the rules:
  - consent to record before an audio channel starts;
  - chunks stored once per sequence number;
  - the duration measured on the Worker's clock;
  - the final transcript replacing the live draft and copied to `discovery_interviews.transcript`;
  - deletion that removes the R2 audio and writes an audit row.
- `sttFormats.ts` has, for each speech-to-text model, its request and response shapes and its live events, plus the speaker labels.
- `sttModels.ts` lists the models the rail offers, priced from `aiRouter`'s own tables.
- `liveTranscription.ts` is the WebSocket relay to Workers AI. It holds the D640 budget in four-minute blocks and settles them on the minutes streamed.
- `sessionSetup.ts` (D685, #1583) holds the setup call's rules:
  - which call providers each channel admits, and the meeting-link host check (video only, HTTPS, the provider's own host);
  - `callLabel`, derived on every read and never stored;
  - the ten languages both final models take, with Flux English-only;
  - the talking points, checked against the project, capped at 10 and snapshotted;
  - `markInterviewHeld`, which moves the interview to `done` and fills its channel when a session stops, a text session's chat is in (pasted, or a channel chat's first text) or a call's transcript is imported;
  - `activeSessionOf`, the one-live-session-per-member check (assistant and channel sessions excluded).
- `interviewProcessing.ts` (D685, #1584) runs a stopped recording to the review:
  - `finishSession` (`POST /sessions/:id/finish`) records the last sequence number and queues the `interview_process` job (a `JobType` that `queueWorker.ts`'s `handleJob` dispatches to `runInterviewProcessJob`); a chunk that arrives late is taken and the job picks it up;
  - the job transcribes chunk by chunk into `interview_chunk_transcripts`, so a retry (`POST /sessions/:id/process`) resumes where it stopped, then summarises and places through D757's engine (`digestSession`, `trigger: 'recording_processed'`, one stage per call);
  - the stage is `uploading`, `transcribing`, `summarising`, `placing`, `done` or `failed`, with `processing_error` in words; a run idle 15 minutes counts as stale and may be retried;
  - `summariseSession` keeps only sentences that cite a transcript segment, and writes a row to `interview_summary_receipts`. Since D757 (#1924) it writes the digest: an overview, key quotes (speaker, time and segment read from the stored segments, never from the model; a quote not in the transcript verbatim is dropped), decisions and next steps, into `digest_json` as a draft; `summary` and `summary_citations_json` come from its overview. A chat session is read as notes over days (`THREAD_SUMMARY_PROMPT`). A long transcript is summarised in parts, at most `MAX_DIGEST_PARTS` (five overview sentences a part, twelve in all); a new run clears `digest_kept_at`/`digest_kept_by`. The draft is read, kept and edited through `GET /sessions/:id` (`digest`), `POST /sessions/:id/digest/keep` and `PATCH /sessions/:id/digest` (`../routes/founder_validate_sessions.ts`), and the Customer research record's Summary section shows a kept digest to every allowed reader.
- `sessionSweeper.ts` (D685 §5.6, #1584) is the recording that outlives its tab, on the Worker:
  - `activeSessionsOf` (`GET /sessions/active`) is the caller's own sessions recording, paused, transcribing or still processing, newest first, without channel or assistant sessions;
  - `sweepInterviewSessions`, every minute from the cron: a draft never started for 24 hours is deleted (with the interview made for it, never one logged by hand), a recording silent for 10 minutes is paused with its time counted to the last chunk, an upload stalled for 30 minutes goes on with what arrived, naming the missing parts in `processing_error`, and a run that stopped moving (transcribing, summarising or placing untouched for 15 minutes, or a recording the old route left in `transcribing`) is resumed through `recoverSession`, once until the run finishes or the member retries; one that stalls again, or that it cannot resume, is failed with a sentence.

### Founder round calls (D653)

`roundCalls.ts` orchestrates private founder calls, counsel fingerprints, idempotent counsel requests and the independent HQ queue, structured term seeds, recipient entitlements, notification outcomes and atomic Raise pipeline responses. Unchanged drafts and computed audience sets preserve approval (D686 #1594, migration 456). `roundCallPolicy.ts` contains flag, verification, readiness, matching and identity policies. The GP capital-call domain is separate. See [D653](../../../documentation/architecture/decisions/D653.md).

D667 (#1497): `assistantInterviews.ts` holds `submit_interview`,
`propose_placements` and `structure_with_axalvc` (listed; `structure_with_studioos` until D1315, kept as an alias and as the stored name) for #1496's MCP server.
Each takes the grant, re-checks the company and the founder's right to write,
and throws a `ToolError` with the issue's status. Consent `given` comes first,
and a placement's quote must be verbatim in the stored transcript. Nothing is
accepted on the founder's behalf. `interviewSessions.ts`'s `deleteSession`
now takes the session's pending proposals with it.

D877 (#2524): `callAudioRetention.ts` keeps a call's audio for its founder's
retention, apart from its text. A call is a session with a Zoom or Meet ref,
or an upload (D872). It reads and writes the member's setting (migration 530;
30 days by default, `null` keeps until deleted), and `purgeExpiredCallAudio`,
run by the daily cron, removes audio past it through `interviewSessions.ts`'s
`deleteSessionAudio`, which the founder's audio-only delete also calls. The
segments stay, and the session records `audio_removed_at` and its reason.

D684 (#1575): `interviewIntake.ts` is the one way an outside channel writes
into an interview. It reloads the member and re-checks the venture on every
write, takes the interview only from an id already scoped to the member, and
stores text where the paste-in Text chat stores it, so Structure and Ask work
on a channel session unchanged. Under D685 §5.1 (S1, #1583), `openSession`
also stores `call_provider` (`zoom`, `google_meet`, `telegram`, `whatsapp`,
each only on a channel `sessionSetup.ts` admits it for) and fills the
interview's `channel` when it had none. The append that first moves a chat
from `draft` to `transcribed` (claimed inside its batch, so it happens once) and
an imported call transcript's first move to `transcribed` mark the interview
held through `markInterviewHeld`, best-effort, after the write lands. New text
on a `structured` chat does not mark it again, so a stage the member set stays,
and an interview with no stage is left alone: the readers already count it as
held on its `interview_date`.
`submitted_via` is unchanged. `channels/` holds the rest.
`conversationAnalytics.ts` (D858, #2503) reads a session's and a venture's conversation figures for `../routes/validate_conversations.ts`: messages by side and source, voice notes, languages, suggestion reach, pain themes, objections, willingness to pay, competitor mentions and quotes per theme. Each is `{ value, sources, reason }`, null with its reason when no store holds it; quotes only where the interview allows quoting, and counts only in the venture read. Since D873 (#2520) a Zoom, Meet or uploaded call is a `call`, its speakers each on their side (the founder's or interviewee's by name, else `unattributed`), with its length from its lines and how its text was made (`transcript_source`). D866 (#2512) names every session's channel (`channelOf`: a call's, else the chat's provider, else `recorder`, else its own channel; NULL when unknown), takes a `channel` filter, and gives a venture's figures per channel. It writes nothing and calls no model.
`sessionAutoStructure.ts` runs D658's Structure without the button: when a
call's transcript is imported, when a chat is assigned, and when an assigned
chat goes quiet. Its findings are proposals for the founder to review. It keeps
#1470's consent rule and the D640 budget, and re-runs at most every six hours,
counting summary receipts and the engine's last attempt too (D757). Since D757
its job is the engine's: `runSessionStructureJob` calls `digestSession` for
every trigger in `JOB_TRIGGERS`. **Since D765 (#2090) only a chat's text and a
voice note queue it on their own** (D720 §6, the owner's two exceptions): an
import, consent, a pasted chat and an assistant's submission store and
transcribe, and the founder presses Summarise or Structure. A chat's final text
(`chat_text_added`), the quiet-chat sweep (`chat_quiet`) and a consented voice
note (`voice_note_added`) still queue the engine.

D757 (#1898): `validateEngine.ts` is the Validate engine's one entry. Every
conversation reaches `digestSession`: the recorder's last two stages, a Zoom or
Meet import, an assigned or quiet chat, the pasted chat and typed notes, consent
recorded after an import, an assistant's submission (the summary only), and the
Summarise and Structure buttons (`force`). Since D765 (#2090) only the buttons,
the recorder's own stages (only when the member chose it at Stop), a chat's
text with its quiet sweep, and a voice note reach it; no other source queues a
digest on its own, and no source calls a model. One transcript is digested once (a sha256 of the final
transcript; a button always runs). An explicit Manual mode for `validate` in
`ai_rail_preferences` skips automatic runs, and the stored model picks apply to
them. An audio session needs consent `given`; `withdrawDigest` honours a
withdrawal. Every outcome is a sentence on the session (`digest_status`,
`digest_note`, migration 487). It writes only the session's summary and digest
columns and pending `validate_proposals`, and every model call goes through
`aiRouter.run`.

D691 (#1696): Grow’s Durable card reads the production compliance calendar’s
`due_date` and `completion_status` columns. Its existing next-90-days filter,
seeded events and new-venture action are preserved; TypeScript maps `due_date`
to the existing calendar field.

D691 (#1697): `growWriters.ts` has one writer per Grow store, called by
`../routes/cycle_grow.ts` and by #1698's actions and feedback-theme fill:
feedback (with `setFeedbackTheme`), channels and their spend, roles (through
`jobBoardCommon.ts`'s `createPosting`, `submitForReview` and `closePosting`,
which keep the board's host-or-admin rule; its `publicCompensation` is the band
the public board shows only when the founder switched it on, #2181), applications, partners and their
revenue, markets, obligations and the durability checklist. Each logs one
`grow.<module>` row through `cycleActivity.ts`. `growKpis.ts` is where a typed
KPI is kept and how each KPI is read (Stripe from the last 35 days over a hand
entry, Runway derived, custom KPIs as `custom-<uid>`); Revenue and traction's
list, its record and Build's roadmap KPI list read through it.

D691 (#1698): `growWriters.ts` also holds the record actions' writers (Mark
told, an experiment, an alert, a deal, an entry step, a localisation check, an
agenda item, Mark held and Open minutes), and `growKpis.ts` checks a KPI's
alerts on every hand entry (`checkKpiAlerts`). `growDaily.ts` is Grow's daily
step, run from `../index.ts` at 05:35 UTC: an obligation's reminders on the
days its `remind_days_json` names, and every venture's KPI alerts, each sent
once, in the app only.

D811: `mailLinkAudiences.ts` reads consented, suppression-filtered Mail audiences and signed D810 links. `mailLinkEvents.ts` validates and atomically applies feedback with receipts and service-actor audit.

D811: `mailLinkTesters.ts` reads picked, consented programme audiences and signs programme/email-scoped preferences and unsubscribe links, with atomic opt-in/out and actor audits.

D886 B1 (#2579): `meetingBots.ts` owns dispatch validation, plan limits,
content-free status projection, the runtime interface and the full-call budget
check. `MeetingBotRun` serializes state and renews two-minute bot-fee holds on
the existing ledger. Transcription remains B6's `aiRouter` charge. See D886 §12
for the callback, runtime lease, privacy and release contracts.

D886 B6 (#2584): `meetingBotAssembly.ts` reads B1's authenticated encrypted
event store, projects roster snapshots and null speaker marks into the pure
mapper in `channels/botTranscript.ts`, and validates the complete uploaded
manifest before using the existing recorder job. The job forces Nova-3 for bot
chunks and reuses their staged `speaker_raw` numbers and paid results. It keeps
the existing `processing_auto` choice: summary/structure are manual unless that
choice was recorded. No second STT or billing path is introduced.

Migration 532 supplies `meeting_bots.participants_enc` (531 stays immutable).
Final participant labels/times, transcript, legacy transcript mirror and receipt
commit in one batch guarded by current consent, audio retention, account and
project access. Per-run ciphertext is the batch marker; a refused guard makes
all later writes no-ops. Retries reuse the staged chunks and cannot duplicate
final receipts. B1 alone writes bot status, after the session reaches done and
the final encrypted participants exist. Processing activity keeps its timeout
alive without extending capture or billing. Stop drains at most 30 seconds;
incomplete manifests fail explicitly. Audio-only deletion retains the final
text and labels; session deletion removes the run and events.

`readBotFinalParticipants` is creator-scoped and returns B7's display-name/time
shape (null before assembly); corrupt encrypted data fails as unreadable. B7
owns mounting this final read alongside its live roster. There is no new route,
feature-switch change, live-runtime validation or production deployment here.

D886 B7: `meetingBotParticipants.ts` decrypts the latest roster for the separate
creator-only participants read. It projects display names/times only, excludes
the bot and emails, and never turns a failed read into an empty list.

Event responses use `eventsCommon.ts` to withhold online and hybrid join URLs
unless a manager or a confirmed seat with settled payment reads them. Public
calendar exports and invitation attachments use the same public projection.

`calendar/` holds the personal source readers, subscription tokens, page-only
item details and external-copy lifecycle helpers; see `calendar/README.md`.

#2440: `calendar.ts` reads only events the member owns, organises or attends,
including for admins. The same boundary feeds the page, calendar downloads,
Google/Outlook sync and individual pushes; staff-wide typed lists stay separate.
`../routes/calendar.ts` checks a founder's project and the caller/counterpart's
recorded membership, deal relationship, assigned deal lead or live advisor session grant before
creating a check-in. IC creation requires a readable deal and validates named
attendees against that exact deal (venture owner/member/advisor, invited or
committed investor, or assigned lead); the organiser explicitly opts themselves in. Passed investor invitations and
withdrawn commitments confer no scheduling rights; investor organisers need a
current relationship too, beyond the legacy deal-reader gate.

D886 B8: `meetingBotRuntime.ts` routes commands to a private cross-script DO
host and derives run-scoped keys. `meetingBotZoom.ts` mints credentials from
the reauthorized stored run, with a run-bounded SDK JWT. No credentials log.

D1119 (#2999): `programCatalogue.ts` reads part 4's shared claim and requested
strategic-access counts, including a claim weekly series and independent failure
states. `programActivity.ts` includes its six audited review actions, naming
Perk listings without exposing member ids or review notes.

`perkClaims.ts` (D957) gives the admin Perks page and program catalogue one
UTC Monday window for claim totals, listing ranks and weekly price-kind counts.
`raiseEvidence.ts` reads active Mercury runway facts and the files current data-room grants can download, for Raise and deck readiness. D1266 (#3289): `previewEvidence` is the founder's See as an investor, the same projection `investorEvidence` returns (`sharedView`), read as an invited investor with an unscoped grant and never logged as an open; the founder's read carries `opens`, the last 30 days of `open_evidence`.
`dataRoomNda.ts` (D1102, migration 608) is the demo-day deck's "NDA required": the founder's `projects.data_room_nda_choice` when set (Yes or No), else true when any file an investor can be admitted to (`tierAdmits()`) is gated `nda`, else null when the room cannot be read. It also says what a write may store as a choice.

`paymentsChangeLog.ts` (D1011) names the fifteen catalogue and Stripe audit
actions and reads them back as the Payments change log (D1129: bound literal
search before count/page/export, and the complete admin filter list); `stripeWebhookDeliveries.ts`
is the webhook's request-log reader, shared by HQ · Platform and Payments, with
hourly buckets that are null for an hour the log was silent.

`google/` holds D1091’s bounded, GET-only Workspace readers over Calendar’s single Google token store. See `google/README.md`.

D1065 (#2935): `buildPlanner.ts` reads accepted Validate labels/counts and applies the ten fixed mapping rules, then batches a plan and source proposals; acceptance stays with D1066. It never runs AI or writes a Build record.

D1066 (#2936): `buildPlanAccept.ts` decides plan items: Accept (with an optional edit) claims the proposal and lands the row through `buildCreates.ts` in one batch with its evidence links, `fill_provenance` rows and activity line, handing the claim back if the batch fails; Dismiss, Accept all in a module (at most 50) and each Build row's evidence trail. `buildCreates.ts` gains the risk, formation-step and prototype-test builders.

D1071 (#2941): `buildPlanWord.ts` is Eadwyn's wording of the plan: the material (pending items' rule titles and evidence labels and counts, never a name, quote or decision), the prompt, the screen (no digit, currency, contact or link leaves) and the wording row (`ai_rail_proposals`, `kind 'draft'`, on `build_plan:<uid>`). Keeping an item's wording goes through `buildPlanAccept.ts`'s `editItem`, and Accept names the run in `fill_provenance`.

D1068 (#2938): `buildHandoffs.ts` is the plan's Send to… and Back in. It builds each tool's text on the server from accepted items (payload, evidence labels without the decision, the brief, a kept Lovable wording), plants each item's marker, runs `lintForSend` as `public` with the markers masked, and records `build_handoffs` (migration 582) with the activity line. It also reads markers for D782's feed (`markerLinks`, `linkProposalStatement`) and decides link proposals (`acceptLink`, `dismissLink`, `linkByHand`); a link re-points the fed item's ledger only to a row of the table the feed writes.

D971 completes `programRegistry.ts`'s Lab draft path: its canonical section
catalogue contains headings only. The existing Super Admin edit route creates a
missing allowed draft section after validation, in the same batch as its edit;
reads do not seed content. Published versions and audit behavior stay in D954's
store; no migration or canvas sample text is introduced.

`capTableAccessRecord.ts` (D1130) copy-builds venture level views from the
issuance record, with stable holder references and fail-closed ambiguous names.
`capTableRegister.ts` now projects that record for venture exports and `/live`;
its account view still reads unassigned connector imports. The venture equity
plan also carries holder-linked filing states without exposing proof keys.

D1129 searches decoded audit detail values, never JSON keys, and includes demoted/deleted payment actors in Who alongside current admins.

D1133: `billingRecovery.ts` prepares caller-owned renewal invoice intents or card-only SetupIntents behind Billing’s fresh-TOTP routes, and records only allowlisted payment-refusal families. `billingAlerts.ts` atomically couples renewal history with alert transitions. No card/client secret is stored.

D1206 (#3172): `calendar.ts` retains personal readers, resolves the
account-owned advisor fallback, reports fixed source error codes without raw
diagnostics, and excludes Calendly before provider sync reads. Missing schema
is not an empty source. Studio reads each allowed source once for active members of its licensed
deployment, excluding private Calendly/wellbeing items, with read-only
projections; All studios requires HQ Super Admin and explicitly reports unread
remote coverage. Neither reader is used by sync or exports (D1206).

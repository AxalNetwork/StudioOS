# cloudflare-worker/src/services — logic, not HTTP

Everything a route needs that is not request parsing or response shaping. A file
here takes `env` and plain values; it does not take a Hono `Context` and does
not return a `Response`.

The split matters because it is what makes the logic testable: the worker suite
runs these directly against an in-process SQLite, with no request at all.

## The ones worth knowing

| File | Why it matters |
| --- | --- |
| `profileEvidenceBlend.ts` | D592's bounded skill-level blend and audited default-off settings read; snapshot versions name the switch state. Only the Super Admin writes through `profile_evidence_blend.ts`; the owner activates it after the synthetic comparison. |
| `interviewStructuring.ts` | D658: an interview transcript turned into Validate placements. The kinds with a schema each (seven, and since D757 §2.6 (#1923) seventeen, each with its MCP module string and its cycle `slug`; `placementSlug` reads a kind that spans two modules by its payload), the rule that a placement without a cited span is dropped, splitting a long transcript without cutting it, Ask's citation check, and Compare's alignment by module. A pain may name one of the founder's themes, never a new one (D757, #1897). Since D757 (#1923) structuring runs as two passes (`STRUCTURE_PASSES`: A, the problem, the person and the market; B, demand and evidence), each call with `PASS_MAX_TOKENS`; pass B refused keeps pass A's placements and returns `passBRefusal`, which the engine turns into its note. |
| `mercurySpend.ts` | D752: a founder's months, burn, cash and runway from their own Mercury lines. Pure, no SQL; financing never lowers burn. |
| `interviewFindings.ts` | D757 §2.6 (#1923): the findings no Validate module table holds (`firmographic`, `job_to_be_done`, `market_fact`, `alternative`, and the demand kinds `budget`, `timing`, `urgency`, `buying_trigger`, `objection`), each with its parse, dedupe key and module, pure so the structure step, the MCP tool and the writer hold a payload to one rule. They land in `interview_findings` (migration 489) through `validateWriters.ts`'s `writeInterviewFinding`, which upserts on `(interview_id, kind, key_norm)` so a retried accept is one row. `presentTables` lets the §2.13 privacy statements (a deleted or withdrawn session clears the findings' quotes; a deleted interview deletes its findings and its interview evidence links) run only where their tables are. |
| `interviewSuggestions.ts` | D757 §2.6–§2.7 (#1925): what a Validate module reads from interviews, reads only. `moduleSuggestions` is a module's pending engine suggestions (`parts.suggestions`, writers only), each with its interviewee, session, first transcript segment, speaker and link to the line, the quote withheld without consent; `findingsFor` is the accepted findings the ICP, Market and Demand records list, behind the Quotes rule; `acceptedPerModule` is Customer research's "What it fed". Accept, one at a time or all at once, stays in `../routes/founder_validate_structure.ts`. |
| `eadwynConnectors.ts` | D652's three rules for connectors in an Eadwyn conversation: the read gate (`readableConnectors`: switched on AND active), the sends a run may only propose (`validateSend`, `SEND_TARGETS`), and the one serialisation and SHA-256 of a payload, so confirm sends what was shown. |
| `tenancyScope.ts` | **The one place row-level scoping is decided.** Returns composable SQL clauses (`esignEnvelopeScope`, `fundGpScope`, `lpMembershipScope`) and fails closed — an actor it cannot identify gets `NO_ROWS`, not everything. |
| `signedDownload.ts` | One-time, short-TTL, HMAC-signed R2 download tokens. Every private file download goes through it. |
| `dealPassTaxonomy.ts` | The five pass reasons and the stage-event recorder. |
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
| `topology.ts` | What a Worker is, stated once per tier (D209, canvases H14 and S14): the bindings each tier declares and what each names (D681's OAuth namespace is HQ-only), both RPC entrypoints method for method with whether anything calls each and whether it takes a secret, what the shared Analytics Engine dataset carries and what it does not, who deploys what, which screens write Worker secrets, and where Cloudflare Access is mounted. **Structural facts are literals** held by `cloudflare-worker/test/topology_d209.test.ts` to the file that decides each — `wrangler.toml`, the RPC classes, the generator, the workflows, `index.ts` — because a deployed Worker carries none of them; **runtime facts** (which bindings are present, whether the SQL credentials are set, where a secret write would land) are read from `env` on the request. Pure over `env`, so it has no store to fail, and it never returns a secret value. Both `GET /api/admin/platform/topology` and `GET /api/branch/deployment` answer from it, so the two tiers cannot describe the architecture two ways. |
| `aiConsumption.ts` | D776 (#2093): a member's own AI runs in a month, grouped by the rail's page, by option within a page, or by record, with what they were charged (`charged_microusd`, D762), and the allowance and token split read once per hold from `ai_budget_reservations`. A NULL charge is counted as Not recorded, never as 0. The member's rows only; `GET /api/ai-budget/runs` serves it. PR 2's `memberMonth` gives HQ the same grouped read for one member, by option within a page, with each run's cost, charge and model; `GET /api/ai-budget/members/:id/runs` serves it to HQ's Admin and Super Admin and audits each read. |
| `aiCost.ts` | D787 (#2212): a member's own AI cost per day and per model for `mtd`, `30d` or `prev_month` (UTC): runs, tokens in and out, the non-token units in `units_json`, `cost_usd` (Cloudflare's cost) and `charged_microusd`, grouped by model, page or option, plus `costCsv`. A refused run counts in `refused` only; a guard run under the guard model; a NULL charge as Not recorded. At most 10,000 runs. The member's rows only; `GET /api/ai-budget/cost` and `cost.csv` serve it. |
| `aiCredits.ts` | D755: the AI top-up balance bought as token packs. `TOKEN_PACK_LIMITS` is §16's one constant block; `ledgerBalance` sums `ai_credit_ledger` (migration 486), which must equal `ai_topup_accounts.balance_microusd` for every member. Holds, releases and spends are written by 486's triggers on `ai_budget_reservations`, so `aiBudget.ts` writes no ledger row. `tokenPackForPrice`, `isTokenPackPrice`, `packOnSale` and `tokenPackQuote` decide what a pack is and whether it can be bought: alone, at face value, no promo, within §16's limits. Only the order intent sells one, and only the payment webhook (`aiTopups.ts`) credits it. `orderTopUp` projects the recorded owner-scoped purchase state and current balance for the order receipt; it never credits or fulfils an order. It returns no projection for historical ordinary orders, even when their prices are later adopted as packs; an explicit pack line without a purchase keeps its receipt with an unreadable marker. Today’s catalogue never reclassifies receipts. Kept apart from Perk and Introduction credits: nothing here reads their ledgers. |
| `planAllowance.ts` | D783 (#2124): a plan includes 25% of its price as AI allowance each month. `PLAN_AI_SHARE` is the share; `allowanceFromCharge` turns a charge into whole micro-USD a month, rounded down, a yearly price ÷ 12. `recordSubscriptionAmount` and `markSubscriptionAmountCanceled` keep `member_subscription_amounts` (migration 505) from the subscription webhook. `planAllowanceFor` sums a member's active member plans (founder, investor, Market Intelligence, advisor and partner; never Registered Agent), falling back to the catalogue's price for a plan with no recorded row. `aiBudget.ts`'s `resolveAiCaps` reads it for every licence but `admin`. |
| `aiCreditReversals.ts` | D755 §8: `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` take a token pack's tokens back, up to the member's balance, recording the rest as `shortfall_microusd`. The share and the balance are read inside the one INSERT that writes the row, so the balance CHECK never fires and racing deliveries take a share once. Acts only on a charge whose PaymentIntent has an `ai_topup_purchases` row; every other charge is untouched. |
| `approvalAssignments.ts` | Who is looking at a board item (D470, migration 341). One current reviewer per lane and item, and an event only when this write changes that person. A missing table stays unreadable — it is not "nobody assigned". A reviewer is an active admin. The write does not change a queue's status and does not open a thread. |
| `activeAccounts.ts` | Active accounts per week, defined once for both tiers (D210): `ACTIVE_ACCOUNT_BASIS` (the sentence both pages print), `activityLogged` (which requests the middleware records — `observability.ts` imports it, so the rule and the log cannot drift), `aeLoggedRequestPredicate` (the Analytics Engine WHERE that mirrors it exactly), `ANALYTICS_RANGES`, `weekAxis`, `weeklyKpi` and `loadBranchWeeklyActives` (a branch's own `activity_logs`, grouped by Monday). A week it cannot count is `null` with one of four reasons, never zero, and each week carries its own reason (`gapNotes` names them once per chart). The KPI is the last complete week; its delta is given only when both weeks carry the same set of series and neither holds a series' first recorded request — `partialWeekReason`'s whole-week rule, which the benchmark median's input and a branch's own figure beside it also read (D211). |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | The advisor state machine and its question banks. |
| `ai/` | D763: the AI router's pure parts. `guard.ts` holds Llama Guard's slicing, verdicts, category policy and refusal copy. Its README has the rule for adding here. |
| `calendar/` | Calendar sync. |
| `channels/` | D684: business Telegram and WhatsApp conversations, and Zoom and Google Meet calls, reaching Validate › Interviews. The contract, event dedupe, connection tenancy, link codes, outbound tracking and the pending-thread store. Its README has the rules. |
| `ai/` | D761: the AI router's request and response shapes, per-class timeouts, context-window and paid-only fallbacks, session affinity and the units each attempt used. D760: `catalogue.ts`, every Workers AI model priced in each unit Cloudflare bills, and `pricing.ts`, cost and billed in exact decimals with `AI_MARKUP` written once. Pure; `aiRouter.ts` calls it. |
| `decks/` | Deck assembly and export. |
| `email/` | Transactional mail. |
| `fills/` | "AI fills the blanks" — the fill-kind registry and the provenance of an accepted fill. A `sourced` fill carries a citation or it is dropped. `neverFill.ts` lists the fields Eadwyn never fills (D777), mirrored by `frontend/src/lib/neverFill.js`; propose, accept and `recordFill` each refuse one. |
| `railProposals.ts` | D780: `ai_rail_proposals` (migration 506), what a rail option's run leaves for the member to decide. `proposeRail` stores a draft, proposal or note with the run's page, option, record, model and `usage_log_id` (refusing a field D777 never fills); `decideRail` is the member's accept, edit or discard, once and on their own rows only; `listRail`, `getRail` and `withdrawRail`. Every option outside Validate and the zone drafts writes here. |
| `market_intel/` | Sourcing, extraction and scoring for market intelligence. |
| `mercury/` | D710: Mercury for fund administration, read-only. A GET-only client, the boundary parser that drops account numbers, the gates and read audit, the entity connections' store, the hourly sync and the reconciliation matches. Its README has the rules. |
| `referrals/` | Referral submissions. |
| `records/` | D690's scoped cycle record contract, registry and ownership checks. |
| `signals/` | Signal ingestion and evidence. |
| `wellbeing/` | Wellbeing check-ins. |

## Rules

`cycleCards.ts` defines the D656 Figure and Card shapes, card failure isolation,
and shared paging. `buildCycleRecords.ts` holds D662's D661-shaped record table,
chart specs and bounded search/filter/sort/paging for the Build modules.

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

D663: `raiseCycle.ts` computes the Raise figures, seven cards and records, plus D686's independently readable, project-scoped Calls history, for
`../routes/cycle_raise.ts`, including the computed readiness checks, the
diligence checklist and the narrative consistency check (fixed patterns, no
model). Since D691 (#1699) each list carries the canvas's title, columns,
filters and default sort (the first in `sorts`), and its row ids are addresses
that never hold a name: an item key, a version, a link, file or prospect id, a
cap-table `h-<n>`, `e-<n>` or `pool`, and a use-of-funds section key.
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
`saveScenario()`, and log nothing themselves.
`dataRoomAccess.ts` (D691 decision 6, #1700) is the data room's one access
predicate, `tierAdmits()`: a file's `access_tier` (`invited`, `committed`,
`nobody`) and `access_expires_at`, with `investorCommitted()` (a committed
prospect of the venture, by email) and `admittedCounts()`. Every read outside
the founder's (the investor room, `research.ts`, the advisor brief) decides
with it, so a hidden file is never listed, counted or downloaded.
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
`propose_placements` and `structure_with_studioos` for #1496's MCP server.
Each takes the grant, re-checks the company and the founder's right to write,
and throws a `ToolError` with the issue's status. Consent `given` comes first,
and a placement's quote must be verbatim in the stored transcript. Nothing is
accepted on the founder's behalf. `interviewSessions.ts`'s `deleteSession`
now takes the session's pending proposals with it.

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

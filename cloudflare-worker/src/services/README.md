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
| `interviewStructuring.ts` | D658: an interview transcript turned into Validate placements. Seven kinds with a schema each, the rule that a placement without a cited span is dropped, splitting a long transcript without cutting it, Ask's citation check, and Compare's alignment by module. |
| `eadwynConnectors.ts` | D652's three rules for connectors in an Eadwyn conversation: the read gate (`readableConnectors`: switched on AND active), the sends a run may only propose (`validateSend`, `SEND_TARGETS`), and the one serialisation and SHA-256 of a payload, so confirm sends what was shown. |
| `tenancyScope.ts` | **The one place row-level scoping is decided.** Returns composable SQL clauses (`esignEnvelopeScope`, `fundGpScope`, `lpMembershipScope`) and fails closed — an actor it cannot identify gets `NO_ROWS`, not everything. |
| `signedDownload.ts` | One-time, short-TTL, HMAC-signed R2 download tokens. Every private file download goes through it. |
| `dealPassTaxonomy.ts` | The five pass reasons and the stage-event recorder. |
| `backup.ts` | The nightly D1 export to R2. |
| `fundSheets.ts` | Super Admin fund research ↔ Google Sheets. Dedicated OAuth, never calendar tokens. Founders cannot Connect. |
| `researchFundRead.ts` | The dossier overlap sentence. A missing cheque end stays open; a missing raise is not an overlap of zero. |
| `researchTaxonomy.ts` | The Research crosswalk (D533, migration 376): which market a company sector label or a fund focus token belongs to, which country a place string means, and each market's market-intelligence sector. Exact-match dictionaries plus hand overrides; every answer carries `method` and `rule`, and a value nothing names stays unmapped — no substring guessing. |
| `securityEvents.ts` | The `security_events` ledger (D200): refusals and step-ups at the auth boundary, subject hashed and network bucketed, one row per minute, 90-day retention sealed by trigger. Never throws — a refusal's own status is never changed by its telemetry. |
| `queueWorker.ts` | `handleJob`, the one dispatch for every queued job type in `../models/jobs.ts`, used by the D1 cron drain here and by `../queue-consumer.ts` for Cloudflare Queues. A new job type needs both a `JobType` entry and a case here, or its messages fail as "unknown job type" (D685's `interview_process` was cast into being without either until S1 registered it, #1584). `AI_JOB_TYPES` is the per-drain AI cap, mirrored in `../queue-consumer.ts` (a test keeps the two equal). `interview_process` stays out of it: on the Cloudflare path a deferral spends one of the message's retries, so the cap would dead-letter a recording's run, which only an admin's manual DLQ retry (`../routes/infra.ts`) replays. The member's D640 budget already bounds that job's AI calls. |
| `deadLetters.ts` | The dead-letter backlog counted once, over **both** of its tables (`dead_letter_queue` and `cf_dlq_mirror`). Read-only, and either table failing makes the whole answer unreadable with the table named — half a sum is never sent as the sum (D202). |
| `platformSwitches.ts` | The switches the platform does have, for HQ Platform (D202) and Switches (D203). **It parses no variable of its own**: each entry calls the predicate its reader calls, because the readers disagree about what "on" means. States only — never a value, never a variable name. `eadwyn_off` is the one with two halves, the deployment's and HQ's, and both are read through `advisorKillState` — the predicate every advisor route calls. |
| `operatorSwitches.ts` | The switch store HQ throws from Platform → Switches (D203, migration 283). **Kill-only**: it can switch a capability off and release its own kill, never switch one on and never lift a deployment's. Read as one 30-second reading per database binding; the writing isolate clears its own reading, a failed read keeps the last good one and retries after the same 30 seconds rather than latching, and with none the store is unreadable — which the gate reads as "not thrown", because a D1 blip must not switch Eadwyn off for everyone. The D1 reads live here and not in `platformSwitches.ts`, whose guard forbids it reading the environment. |
| `supportQueues.ts` | HQ Support's three queues read from HQ's own records (D204). **One definition of an open ticket** — `OPEN_TICKET_STATUSES` and `ticketBacklog`, which HQ Home's Queue backlog reads too — and `personaOf`, which sorts each open ticket by its requester's standing NOW: no account, a closed account, bound in `licence_admins` (the binding beats the role), HQ staff, else an HQ-held user. The licence kind is never read. Every read answers for itself: a failed one is `available: false` with its reason, a read past its ceiling is `complete: false` and its count is withheld rather than shown as the length of a cut list. The GET never runs the sync bootstrap. |
| `escalationConcerns.ts` | What a content escalation can name (D208): HQ's template library as pushed to the branch, and the branch's own newest hundred articles. **One label format**, `concernLabel`, builds both what the drawer lists and what the route stores and sends to HQ, so the two are the same bytes; a long title gives way before the slug does, and the whole fits the 300 characters both escalation tables keep. The list never throws — each source reads in its own try, and an unreadable one is its own state with its reason, never an empty list. A pick is read again at the raise (`resolveConcern`), never taken from the client, and one that no longer resolves is a typed refusal the route turns into a 400 or a 503 before HQ is called. A label names an item; it does not say the submission localises it, which is why HQ's Localised count stays unrecorded. |
| `topology.ts` | What a Worker is, stated once per tier (D209, canvases H14 and S14): the bindings it declares and what each names, both RPC entrypoints method for method with whether anything calls each and whether it takes a secret, what the shared Analytics Engine dataset carries and what it does not, who deploys what, which screens write Worker secrets, and where Cloudflare Access is mounted. **Structural facts are literals** held by `cloudflare-worker/test/topology_d209.test.ts` to the file that decides each — `wrangler.toml`, the RPC classes, the generator, the workflows, `index.ts` — because a deployed Worker carries none of them; **runtime facts** (which bindings are present, whether the SQL credentials are set, where a secret write would land) are read from `env` on the request. Pure over `env`, so it has no store to fail, and it never returns a secret value. Both `GET /api/admin/platform/topology` and `GET /api/branch/deployment` answer from it, so the two tiers cannot describe the architecture two ways. |
| `approvalAssignments.ts` | Who is looking at a board item (D470, migration 341). One current reviewer per lane and item, and an event only when this write changes that person. A missing table stays unreadable — it is not "nobody assigned". A reviewer is an active admin. The write does not change a queue's status and does not open a thread. |
| `activeAccounts.ts` | Active accounts per week, defined once for both tiers (D210): `ACTIVE_ACCOUNT_BASIS` (the sentence both pages print), `activityLogged` (which requests the middleware records — `observability.ts` imports it, so the rule and the log cannot drift), `aeLoggedRequestPredicate` (the Analytics Engine WHERE that mirrors it exactly), `ANALYTICS_RANGES`, `weekAxis`, `weeklyKpi` and `loadBranchWeeklyActives` (a branch's own `activity_logs`, grouped by Monday). A week it cannot count is `null` with one of four reasons, never zero, and each week carries its own reason (`gapNotes` names them once per chart). The KPI is the last complete week; its delta is given only when both weeks carry the same set of series and neither holds a series' first recorded request — `partialWeekReason`'s whole-week rule, which the benchmark median's input and a branch's own figure beside it also read (D211). |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | The advisor state machine and its question banks. |
| `calendar/` | Calendar sync. |
| `channels/` | D684: business Telegram and WhatsApp conversations, and Zoom and Google Meet calls, reaching Validate › Interviews. The contract, event dedupe, connection tenancy, link codes, outbound tracking and the pending-thread store. Its README has the rules. |
| `decks/` | Deck assembly and export. |
| `email/` | Transactional mail. |
| `fills/` | "AI fills the blanks" — the fill-kind registry and the provenance of an accepted fill. A `sourced` fill carries a citation or it is dropped. |
| `market_intel/` | Sourcing, extraction and scoring for market intelligence. |
| `referrals/` | Referral submissions. |
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

D654: `updateShare.ts` holds Grow › Share an update's rules for `../routes/portfolio_updates.ts`:
metrics from `project_metrics` with source and date (a missing one is null, never 0),
highlights and lowlights that must name a source, Eadwyn's draft through `aiRouter`
(`AI_SURFACE.growUpdate`) that keeps only lines citing a stored fact, what each audience
may read (the network: asks only unless metrics are included), and where a reply to
each kind of ask lands.

D659 (#1472): `cycleCards.ts` is the shape every cycle read returns: `Figure`,
`Card`, the five states, and `safeCard` / `safeFigure`, which turn a thrown
source into that one card's `unreadable`. Build, Raise and Grow import it.
`validateFocus.ts` (D685 §5.12, #1584) is what Validate's overview leads with on a phone: the focus (record the first conversation; review the newest session, counting the pain themes and hypotheses its pending placements would move; else the first card's next), the interviews meter against `interviews_month_target`, and the index's two counts.
`cycleValidate.ts` computes Validate's figures, cards and records from records
at read time and stores nothing. `validateWriters.ts` has one writer per
migration 440 record. The manual routes and #1471's interview accept path both
call it, and each writer records its actor.

D664: `cycleCards.ts` holds the read every cycle shares (D656, #1469): the card
states, the `Figure`/`Card`/`Records` types, `settleCard` (a failing source makes
only its card unreadable) and paging. `growCycle.ts` computes the Grow figures
and seven cards for `../routes/cycle_grow.ts`. `revenueMovements.ts` splits the
revenue ledger into new, expansion and churned by month (only when customers can
be told apart; churn needs two billings) and rewrites `revenue_movements`.

D663: `raiseCycle.ts` computes the Raise figures, seven cards and records for
`../routes/cycle_raise.ts`, including the computed readiness checks, the
diligence checklist and the narrative consistency check (fixed patterns, no
model). `raiseWriters.ts` has one writer per migration 442 record.
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
  - the job transcribes chunk by chunk into `interview_chunk_transcripts`, so a retry (`POST /sessions/:id/process`) resumes where it stopped, then summarises and places through `structureSession` (`trigger: 'recording_processed'`);
  - the stage is `uploading`, `transcribing`, `summarising`, `placing`, `done` or `failed`, with `processing_error` in words; a run idle 15 minutes counts as stale and may be retried;
  - `summariseSession` keeps only sentences that cite a transcript segment, and writes a row to `interview_summary_receipts`.
- `sessionSweeper.ts` (D685 §5.6, #1584) is the recording that outlives its tab, on the Worker:
  - `activeSessionsOf` (`GET /sessions/active`) is the caller's own sessions recording, paused, transcribing or still processing, newest first, without channel or assistant sessions;
  - `sweepInterviewSessions`, every minute from the cron: a draft never started for 24 hours is deleted (with the interview made for it, never one logged by hand), a recording silent for 10 minutes is paused with its time counted to the last chunk, an upload stalled for 30 minutes goes on with what arrived, naming the missing parts in `processing_error`, and a run that stopped moving (transcribing, summarising or placing untouched for 15 minutes, or a recording the old route left in `transcribing`) is resumed through `recoverSession`, once until the run finishes or the member retries; one that stalls again, or that it cannot resume, is failed with a sentence.

### Founder round calls (D653)

`roundCalls.ts` orchestrates private founder calls, counsel fingerprints, recipient entitlements, notification outcomes and atomic Raise pipeline responses. `roundCallPolicy.ts` contains flag, verification, readiness, matching and identity policies. The GP capital-call domain is separate. See [D653](../../../documentation/architecture/decisions/D653.md).

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
#1470's consent rule and the D640 budget, and re-runs at most every six hours.

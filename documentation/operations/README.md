# documentation/operations — runbooks

**A runbook is the steps an operator follows to change or recover production.**
Each file here answers one "how do I…" question, and is kept true as the system
changes. What production *is* lives in `documentation/architecture/`; these
files say how to act on it.

| File | Use it to |
| --- | --- |
| `STRIPE_RENEWAL_GRACE.md` | Configure failed-payment termination and verify the bounded grace and webhook payload version (D1100). |
| `STRIPE_WEBHOOK_RECONCILIATION.md` | Tell "no webhook event expected" from a broken delivery path with the read-only reconciliation, and read the post-deploy smoke's Stripe line (D8512). |
| `USAGE_RETENTION.md` | Retention tiers for the AI usage, reservation, ledger, run and proposal tables, what blocks moving a row today, and the counsel and owner gates before anything is archived or deleted (D4568). |
| `D1_BENCHMARK.md` | Measure whether the one D1 database limits mixed agent and financial load: the local benchmark (`npm run bench:d1`), the owner's read-only production baseline, the hosted preview run behind #4566's preflight, and what each result may claim (D4567). |
| `AGENT_EXECUTION_VALIDATION.md` | Test agent execution outside production: the preview isolation matrix, the fail-closed preflight, synthetic fixtures and their cleanup, the owner-only actions and teardown, and how evidence is classed (D4566). |
| `STAGING.md` | Provision, rebuild and tear down staging, the isolated `studioos-preview` Worker over synthetic data: the resource inventory, the cost estimate awaiting the owner's approval, the isolation rules and the runbook (D7147). |
| `AGENT_ENGINE_GO_LIVE.md` | Prepare and stage agent rollout, verify the $100 gateway limit, cohort membership, halt and breaker controls (D4423). |
| `DEPLOY.md` | Ship the Worker and the SPA to production, and roll a deploy back. |
| `MERGE_CONTROL_POLICY.md` | Read the `merge-control/policy` check: the events that post it, what T0, T1 and T2 mean, what `action_required` asks of a person, sign-off (not built yet), break-glass (D5605 row 1), fail-closed behaviour and the kill switch (#5991). |
| `DATA_RETENTION.md` | Look up how long each deck store keeps its rows and R2 objects, what removes them, and the known gaps (D1508). |
| `PROCESSING_AND_RETENTION_5510.md` | Trace Axal VC data collection, tentative processor/vendor inventory, erasure/retention evidence and pending legal/production verification without publishing secret or user data (#5510). |
| `DECK_GRID.md` | Run deck builder v2, the Grid (D1547, #3792): switch off a model, refund a batch, unstick a batch, purge an image including a DMCA takedown. Says which steps have a route, which are SQL, and that none is tested on staging yet; `deck_grid_runbook_3792` keeps the names true to the code and `deck_grid_runbook_d1547` runs the SQL. |
| `D1_RECOVERY.md` | Recover D1 when the data is wrong and a Worker rollback will not help. |
| `COUNTRY_CATALOGUE_RECONCILE.md` | Check every country figure in the licence-pricing catalogue against its history, repair the one value with no history row, build and send the import through the supported route, and read again (D7714). |
| `SCHEMA_DRIFT.md` | What schema checks run before a deploy, what the post-deploy `schema-drift` job finds after it, and how a red result is escalated and corrected without silencing the check (#4591). |
| `INCIDENT_RESPONSE.md` | Respond to an incident: severities, response times and who is paged. |
| `CLAUDE_REVIEW.md` | Run, tune and cost the advisory pull-request review on the Anthropic API. |
| `FREE_SECURITY_7899.md` | Maintain free deterministic GitHub security controls, handle scanner findings through S21, and roll out Dependency Review safely through the merge queue. |
| `GITHUB_CONNECTOR_APP.md` | Register the StudioOS GitHub App for the GitHub connector (D655), put its Client ID and secret in production, check, rotate and remove them, and troubleshoot a failed connect. |
| `TICKET_GITHUB_SYNC.md` | Recover support tickets that were saved in D1 but never reached GitHub, and set up the sync's secrets and inbound webhook. |
| `GMAIL_OAUTH.md` | Set up, check and rotate the Gmail OAuth client and refresh token the Worker sends the platform's own email with (#9059). |
| `OAUTH_PROVIDERS.md` | Find the host every OAuth callback uses (`OAUTH_CALLBACK_BASE_URL`), and register the Google Calendar and LinkedIn clients and their secrets (#9059). |
| `TELEGRAM.md` | Set up the Telegram Business interview bot, check it on a real phone, rotate its secrets and switch it off (D756). |
| `WHATSAPP.md` | Switch WhatsApp Business on, check it on a real phone and roll it back (D754). |
| `TEAMS_ENTRA_5809.md` | Inventory the Microsoft calendar app that creates Teams meetings, register its exact callbacks, set and rotate its client, run the licensed-organizer live proof, and recover from each refusal (#5809). |
| `MEETING_BOT.md` | Set up Eadwyn AI for Zoom, Google Meet and Teams; check notice, consent and retention; interpret failures; switch it off (D886). |
| `AGENT_RUNTIME_SWITCH.md` | Stop every agent run at once, pause the engine, switch the agent runtime behind its seam and rebuild each scope, and what still works while the engine is down (D1528). |
| `ZOOM_AND_MEET_TRANSCRIPTS.md` | Create and share the Zoom app, switch on Google Meet transcript import, run the live check, read each refusal and roll back (D757). |
| `AI_TOKEN_PACKS.md` | Run AI token packs (D755): create, adopt and archive packs, handle refunds and disputes, an overdue credit, adjustments and reconcile, and run the live purchase-and-refund check. |
| `AIRAIL.md` | Run the Eadwyn AI rail (D720): how a page gets its models, add a model Cloudflare publishes, how members are billed, and where a member's consumption is shown. A draft until D781 closes. |
| `CLOSING.md` | Run a closing end to end (D1220): open it, prepare and send the paper, countersign for Axal, choose each route, share instructions, record evidence, the founder's cap-table decision, and Mark Closed; what no page does yet. |
| `MERCURY_MEMBER_CHECKS.md` | Run D752's read-only live checks: four Mercury field names for S02 or S03, and the owner's walk-through with a test investor and founder (#1008 item 34). |
| `MCP_API_RUNBOOK.md` | Switch member API keys for `/mcp` on, check them read-only, roll back, revoke a member's keys and read usage in aggregate (D850). |
| `LOVABLE_CONNECTOR.md` | Add Axal VC to a Lovable workspace as a custom connector: mint the OAuth client, the form's values, connecting and checking (D1361). The contract is `AXAL_CONNECTOR_API.openapi.json`. |
| `REDIRECT_RETIREMENT.md` | Retire the SPA's internal redirects on 2027-01-19 (#2301): what is counted and kept, the D1 query for the last 30 days, and what to remove. |
| `PITCH_ACCEPTANCE.md` | Run the Pitch deck studio's Founder acceptance gate (#3662): the synthetic fixtures, the offline harness, the live screenshot and export run, and the pass / fail / not-tested matrix at a revision. |
| `PLATFORM_OBSERVABILITY.md` | Look up what production binds, which platform metrics exist, their source, unit, threshold and missing-data rule, and what waits on the owner (D4559). |
| `S1_HANDOFF_2026-10-18.md` | Take over S1, the coordinator session. A dated handoff, true on its date. |
| [`CODEBUILD_RUNNER_6724.md`](CODEBUILD_RUNNER_6724.md) | Prepare an isolated CodeBuild runner, benchmark it against GitHub and roll back queue routing. |
| [`CODEBUILD_RUNNER_6724.yml`](CODEBUILD_RUNNER_6724.yml) | Reviewable AWS project template for the nine suite shards. |
| `RUNNER_BOOTSTRAP.md` | Prepare pinned native runner profiles and perform private, restricted organization enrollment (D7885). |
| `RUNNER_CAPACITY.md` | Stage hosted/Mac/Linux capacity with ownership, exact-result authority and operational evidence gates (D7884). |
| `CI_COVERAGE.md` | Look up, for each source folder and Worker service, which CI checks run, when, whether they are required, the highest evidence level and the open gap issue. Generated by `node scripts/ci/coverage-matrix.mjs`; `--check` in `npm run test:guards` fails a stale copy (D8694). |

## Adding one

Name the system and the action in the title. Give secret and variable names
only: no value belongs in a runbook, in the repo or in an issue. Add a row here
and a link in `documentation/README.md`.

| `ENGINEERING_EVENTS_5664.md` | D5664: read-only workflow/provider inventory, pilot counts and deployment gaps. |
| `ENGINEERING_SLACK_5665.md` | D5665: destination kill switches, canary and uncertain-send recovery. |
| `ENGINEERING_SLACK_ROLLOUT_5668.md` | #5668: public rehearsal evidence and rollout acceptance checklist. |
| `CLOUDFLARE_ROLLOUT_5670.md` | D5670: source-to-receipt rollout, privacy, outage and rollback checklist. |
| `CLOUDFLARE_DELIVERY_5671.md` | D5671: private registry/secret setup, connectivity versus receipts, canary, fallback and rollback. |
| `AGENT_COMPUTE_4557.md` | D4557: local image evidence, immutable scheduling gate, preview acceptance and rollback. |
| `WORKFLOW_SLACK_6370.md` | D6370: configure the sender, validate a workflow attempt and pause delivery. |
| `WORKFLOW_FAILURE_ISSUES_6387.md` | D6387: GitHub repair issue activation, evidence and replay. |
| `R2_INVENTORY.json` | D6650: reviewed source prefix classes, unknown retention bases, explicit copy approvals and dynamic-key provenance. `node scripts/build-r2-inventory.mjs --write` renders it with every current call site beside it as a generated, gitignored Markdown inventory. |

| `RUNNER_CAPACITY_RUNBOOK.md` | D7888: staged runner capacity proof, eligibility-first drain, private budget controls and hosted rollback; preparation only. |
| `RUNNER_CAPACITY_EVIDENCE_7888.md` | D7888: sanitized existing-run observations and explicit missing live-proof evidence. |
| `production-credential-inventory.json` | D7145 job, trigger, credential and environment assignments checked in CI. |
| `GITHUB_ADMIN_BASELINE.md` | D8082: the GitHub admin settings `slot:chatgptpro` set (rulesets, environments, Actions, Apps, runner groups; cloud names and quotas), which the weekly read-only `admin-drift.yml` checks, filing one issue per drift. |
| [Production credentials](PRODUCTION_CREDENTIALS.md) | D7145 environment setup, token permissions, verification and retirement. |
| `runner-image-8008/` | Review the Linux candidate runtime contract, offline image inputs and qualification evidence gates (D8008). |
| `RESEARCH_SOURCE_IMPORT.md` | D7745: preview, apply in bounded chunks, seal, reconcile and remove a private Research package; pacing, 429s and which digest proves what. |

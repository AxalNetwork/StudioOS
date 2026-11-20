# Stage additive CI capacity (D7884, #7884)

This is the rollout and evidence contract, not an assertion that extra capacity
is live. The immediate scope is one approved temporary Jelastic Linux executor,
the optional native Mac, and the existing standard GitHub-hosted pool. No fleet
or production routing is enabled by this document.

## Current baseline and ownership

Main inspected: `43d43132b8a8df475b2d994759daa846fe2a0f87` on 20 November 2026.
PR #7882 remains open at `ec9eb07ced2ea69b31dd6f025a3a465d21313c84`.
Its exact-source/plan admission, child result/failure preservation, bounded
cancellation and native Mac evidence are groundwork. Its hosted parent waits
while the Mac runs, so it does not release a hosted concurrency slot. It is not
the completed capacity solution.

| Owner | Deliverable | Boundary |
| --- | --- | --- |
| #7885 / s38 | Shared profile/bootstrap and one approved Linux pilot | No CI caller, reusable executor or group-access edits |
| #7886 / s39 | Trusted main-published direct executor and admission | Caller activation stays disabled; group access must name the job-defining workflow |
| #7887 / S32 | Durable routing, fencing, bounded fallback and authoritative aggregate | Initial draft #7890 is an isolated coordinator core, not deployed authority |
| #7888 | Measured overlap, failure/drain/teardown and 1 → 5–10 evidence | Additional machines need separate approval |
| #7889 | Optional 50-runner/provider adapter | Blocked on small-pool proof; no scale-out now |
| #6677 / #7882 | Existing runner-lane/caller groundwork | Coordinate exclusive ownership before any ci.yml/caller/gate change |

No child ownership transfers through this epic. Existing #7882 files, production
callers, required-check consumers, permissions and CI matrices remain unchanged
in this planning PR. #5600 remains the broader landing-capacity epic.

## Pool and profile contract

Use `scripts/ci/runners/profiles.json` from #7885, schema v1. The agreed candidate
IDs are **hosted**, **linux-x64**, **macos-arm64**; hosted maps to the fixed standard
ubuntu-latest target and is never a self-hosted group member. External profiles
include real OS/native architecture, GitHub AND labels, exact tool/archive pins
and the shared studioos-worker-v1 capability. Names are unique inventory IDs,
never hostname-specific runs-on selectors.

One centrally approved organization group is shared only with StudioOS. The
proposed common StudioOS Worker Pool name and numeric ID need administrator verification;
the ID stays null until a reviewed profile update records that observation.
A repository-only registration is not organization-group enrollment. The
repository Runners page shows registered/assigned resources; ordinary hosted
machines are provisioned on demand and need no persistent registration there.

Adding another approved compatible machine repeats the same bootstrap/profile,
receives a distinct persisted inventory name and joins through the same group/
capability labels. It requires no per-host YAML or new workflow. The router
refreshes only the approved group/profile inventory and subtracts durable
reservations; it does not treat every online self-hosted machine as safe capacity.
Native GitHub assignment chooses an idle matching member within the selected
pool. It does not spill a queued external job into a hosted job automatically.

The bootstrap's local tool checks are not a verified eligible-shard set. Mac
starts with the already benchmarked worker-1-of-6 only. The executor/router must
validate workload compatibility and measured resources before selecting any
additional parts. Unsupported architecture, emulation, missing pins, missing
receipts or unverified group/isolation leaves the node ineligible.

## Preserve standard hosted capacity

Keep all six logical Worker shards and exact plan coverage. Frontend, rest and
other hosted-only work remains on standard ubuntu-latest. Fork PRs, PRs in the
initial rollout and unknown provenance stay hosted. The Mac is optional; a merge
must be able to complete without it.

Initial external delegation is at most two compatible Worker shards per eligible
run when resources permit. Retain several hosted Worker jobs in the initial
six-part plan and a permanent floor of at least one hosted Worker shard in later
stages. Standard hosted remains both an active share and the fallback pool.
Respect the actual organization hosted concurrency limit, which is not observed
from this integration; do not substitute a paid larger-runner label or assume
that runner registration increases that quota. More external machines increase
capacity across simultaneous runs, not the shard count inside one run.

## Durable authority and exact-result rules

Planning/submission may use a brief hosted job; it must finish promptly rather
than poll or sleep while external work runs. Routing decisions, reservations,
leases, deadlines and reconciliation belong outside Actions runners. The
independent Merge Control runtime is the candidate reuse point only after its
deployment, availability, recovery and permission boundaries are verified.
Repository source and a local coordinator test do not establish that deployment.
S32 reports that the connected Worker inventory did not contain it; this session
has not independently established a live authority or configured an authority URL.

The #7886/#7887 receipt contract is versioned, immutable and bound to authenticated
original event/run/attempt, repository, exact source SHA, logical shard, exact plan
identity, trusted executor revision, owned dispatched child run and lease
generation. `queueBaseSha` is required for a merge group and null otherwise,
sourced from the authenticated original event rather than a moving main ref.
Fork, unknown, expired, revoked or superseded provenance is refused. Admission
code loads from the trusted executor revision before candidate checkout. Exact
parent timing plans and deterministic merge-group planning stay distinct; do not
silently regenerate a different shard/file list.

Dispatch acknowledgement is not success. The authoritative aggregate check on the
exact candidate must require every expected owned shard, including hosted work.
Only the real test step, job and owned run passing establishes a pass. Actual test
failure stays red, trace upload is advisory, and a late superseded result cannot
overwrite the current attempt. Bounded infrastructure failure may create a hosted
fallback only under the coordinator's owned generation/cancellation rules; it may
not turn a failed test into a green retry. Required producer/App binding and every
gate consumer need review before cutover. No additional App/webhook/lifecycle or
provider permissions are implicitly granted by this epic.

## Staged activation and rollback

1. Land bootstrap/profiles and prepare one approved Linux machine without
   registration/caller changes. Preserve the old Mac workflow/group for recovery.
2. Land #7886's trusted executor on main with callers disabled. Record the full
   immutable main SHA before any consumer references it. Verify the group accepts
   that directly defining trusted workflow and rejects an unselected workflow or
   untrusted branch definition.
3. Prove separate listener/job identity isolation, owned per-job temp/cache paths,
   cleanup and no surviving candidate processes. Same-UID host execution can read
   listener OAuth files and is not sufficient. Keep operator/provider/App and
   registration credentials outside jobs.
4. Obtain private approved node, time/spend and teardown references. Inspect current
   organization registrations/group settings; drain rather than duplicate a Mac
   listener. Enroll at organization scope only after restricted access is verified.
5. Run the small trusted standalone Linux/Mac compatibility canary after publication
   and any required backlog exception. Record identity, OS/architecture, effective
   CPU/memory, Node/Python/SQLite and exact test truth. Do not call this production
   spillover. No broad benchmark or load dispatch while #5719 remains open.
6. Verify independent authority deployment/recovery and the minimal reviewed
   permission/gate diff. Land #7887's later caller/aggregate cutover only after
   source, receipt, cleanup, cancellation and consumer evidence is complete.
7. Under #7888, demonstrate concurrent real hosted + Mac + Linux jobs without a
   hosted waiter; exercise real test failure, start loss, uncertain cancellation,
   offline/busy Mac, revoked enrollment, lost result, drain and provider teardown.
   Keep the baseline available through each exercise.
8. Scale to 5–10 only after measurements and a new approved budget. #7889's optional
   50-runner adapter is a separate later approval and is not needed for the pilot.

Rollback disables new external submission while preserving hosted work and exact
aggregate-result obligations. Reconcile or revoke owned external generations,
confirm cancellation/drain, stop the listener, unregister privately and verify
provider teardown. Do not call an acknowledged cancellation a stopped job, lose a
real failure, or remove required-check protection. An already queued native job
does not automatically transfer pools; the durable coordinator owns fallback.

## Evidence ledger and current blockers

| Criterion | Evidence required | Current state |
| --- | --- | --- |
| Standard hosted baseline remains active | Workflow diff and exact six-shard plan coverage | Preserved; no caller/workflow changes here |
| Reviewed group/profile | Administrator read of exact repository/workflow restrictions and approved numeric ID | Unverified; integration reads return 403 |
| Bootstrap/tool integrity | Offline lifecycle cases plus actual pinned Linux artifact probe | #7885 implementation; local proof is distinct from live node |
| Trusted executor on main | Immutable SHA, direct-job workflow and refusal canaries | #7886 in progress; not established on inspected main |
| Native Mac baseline | D7881 benchmark/tracing links and workload limits | Reported groundwork in #7882, not newly exercised here |
| Independent durable authority | Deployment/version/status, restart/recovery and controlled permissions | Not verified; no authority URL activated |
| Linux pilot and budget | Private node/runbook, time/spend limits and scheduled provider teardown | Owner supplied existing runner 44451/group 5 and an 18:00 Europe/Zurich stop; run 44746099004 reached its 40-minute limit; it was cancelled, with artifact upload and owned-file cleanup successful |
| Result/gate authority | Exact candidate aggregate + producer/App and all consumer review | Pending staged #7887 cutover |
| Additive overlap and fallback | Public owned run/job/source/executor links, timings, failure/drain proof | Pending #7888 after prerequisites |
| Later scale | Controller/provider measurements and separate approved expansion | #7889 blocked; no scale-out |

Publish only public CI links, source/executor SHAs, sanitized capacity counts,
timings and test outcomes. Account identifiers, infrastructure addresses,
registration material, provider credentials and billing balances stay in the
private operator record. The approved cost cap is not a claim of unused credit.

The owner-approved standalone Linux pilot uses the smoke definition at
fe1c1ce6b48260e90a0c1049f0c0216701125758 on ci/linux-runner-test, testing source
c6d0d48a984847a2b14325c82e9616da4c3dfdcf. GitHub job metadata independently
matches runner 44451, group 5 and the expected Linux/X64/shared capability labels.
Its runtime/dependency setup passed; Worker/cleanup result must remain truthful.
The branch definition is not on inspected main and its smoke-only group is not
approval for production routing or bootstrap re-enrollment. No duplicate pilot is
started here. The 40-minute job and 17:00 UTC node stop limits apply; provider
stop/teardown remains an operator action, not something inferred from job exit.

This epic stays open until the actual initial milestone is proved. Bootstrap
installation, an open draft, a dispatch acknowledgement or documentation alone
does not complete #7884.

Recorded outcome: the existing Linux pilot ran 13:44:37Z–14:25:00Z and the
GitHub check annotation confirms the configured 40-minute limit was exceeded.
Worker execution was cancelled; setup/runtime/source/plan/dependencies, artifact
upload and owned-file cleanup passed. Trace summary was skipped. No Worker pass,
complete process drain, provider teardown or additional capacity milestone is
inferred. Full overlap and bounded-failure acceptance remain with #7888. The
owner's 17:00 UTC node stop remains an operator action, not an effect of this
planning/observational work.

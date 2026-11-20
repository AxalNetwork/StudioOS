# Runner capacity: proof, drain and staged growth

D7888 / #7888, under #7884. **Preparation, not an activation record.** The
bootstrap/profile (#7885), trusted executor (#7886), and asynchronous router
(#7887) are not on the main revision used for this preparation. The live
three-pool proof, private budget and provider meter are **Not recorded**.
Existing observations are in [the evidence record](RUNNER_CAPACITY_EVIDENCE_7888.md).

## Boundaries before any canary

The approved starting scope is one temporary Linux executor, an optional native
Mac, and the existing standard GitHub-hosted pool. This document authorizes no
machine creation, registration privilege, permission change, paid larger runner,
new workflow run or rollout. The queue-pressure policy in AGENTS.md still applies.
Do not create a fleet or repeat full CI to obtain a benchmark.

The existing #7882 design retains a hosted controller while the Mac executes.
Its passing checks are useful groundwork, not proof of added hosted capacity.
Do not change its callers, admission, or gate authority from this task. #6677's
CodeBuild rollout remains off; it is not the approved temporary Linux provider.

Before the first bounded exercise, record privately:

- Published immutable bootstrap, profile, executor and coordinator revisions;
  approved organization group, selected repository and exact allowed workflow.
- Explicit temporary spending envelope, resource ceiling, meter and billing-lag
  source, expiry, last-admission time and shutdown deadline. Credits must actually
  apply to the account and resource being used. Unknown funding denies admission.
- Provider resource inventory, residual billable volumes/IPs/snapshots, responsible
  operator and who can stop it. Public evidence includes no account, balance,
  email, hostname, address, credential, or registration token.
- The exact bounded test count, expected logical shard set, source/executor SHAs,
  original run/attempt, plan digest, deadlines and owned child IDs. Keep the current
  six-shard CI plan unchanged; a small standalone canary does not claim full CI.

Stop new admission before expiry by at least the worst-case remaining owned job,
drain/termination time and meter lag, with reserved credit for that work. A
runner-process stop does not stop a cloud bill.

## Bootstrap and compatibility

Start at the StudioOS repository's Settings → Actions → Runners page. Follow
#7885's reviewed organization-scoped enrollment and published command/profile
sequence once it exists. **No executable bootstrap command is recorded here
yet:** its interface has not landed. Do not invent flags or enroll at repository
scope to bypass the restricted group. A repository-only registration is not proof
of group membership; drain and correct it through the reviewed operator flow.

Verify actual OS/architecture, runner distribution digest/version, Node and Python
versions, SQLite support, workspace isolation and dependency compatibility before
advertising the capability label. Begin with one runner process per machine.
Use unique private inventory identity but the same approved group/capability
profile; no per-host label or workflow edit. Unsupported machines stay ineligible.

The Mac must remain awake and online; sleep/offline is optional lost capacity,
never a merge prerequisite. On Linux, exercise service restart/status using the
published bootstrap service, then reverify dependencies and group enrollment.
An image/runtime update is a new pinned profile with a bounded compatibility
canary, not an unattended upgrade underneath an active job. Node replacement
follows drain/removal first; an expired or leaked registration is recovered by
the separate short-lived enrollment issuer, never by credentials inside a job.

## Collect read-only timing evidence

After #7886/#7887 publish their verified receipt interface, an operator supplies
a private version-1 report manifest with:

- `repository: AxalNetwork/StudioOS`, full `candidate_sha`, full `executor_sha`,
  and the 64-hex `plan_sha`; `parent` has only `run_id` and `attempt`.
- At most 32 `requests`, each containing `shard` (`worker-N-of-6`), `generation`,
  exact `run_id`, `attempt`, `job_id`, numeric `test_step` and `profile`
  (`standard-hosted`, `linux-x64`, `macos-arm64`). These are declarations, not
  authorization. No field named `verified` can establish trust.
- Private `approved_group_id` and `capability_label`, and up to 16 parent
  `controllers` with `job_id` and recorded numeric `wait_steps`. Unknown wait
  phases are null, not an empty declaration of no waiting.

Run the available GET-only reader:

```sh
node scripts/ci/runners/verify-capacity.mjs --manifest /private/capacity-manifest.json
```

It bounds the entire collection to 100 API reads, fully paginates attempt jobs,
checks exact run/job identities and prints only an allowlisted report with
pseudonymous runner references. A page failure or cap yields unavailable evidence,
never a partial count presented as complete. It makes no dispatch, cancellation,
registration, provider, check-publication or permission call.

The current reader intentionally reports `live_capacity_proof: not_verified` and
`authoritative_result: null`: GitHub metadata alone cannot establish which source
and plan actually executed. #7886/#7887's reviewed receipt integration is still
needed. Do not wire this report to a required check or treat its exit 0 as a
passed shard. It proves a report could be read, nothing more.

## Bounded proof matrix

Once the prerequisites and canary are approved, collect public run/job links and
exact times for compatible standard-hosted, Mac and Linux test work overlapping
in real execution. Require real test step, job and owned run outcomes; skipped or
cancelled work is not a pass. Verify the full immutable source/plan binding from
the coordinator, not a caller-supplied ID. No arbitrary result can satisfy a newer
lease generation, and a confirmed failure cannot become an infrastructure retry.

Report queue wait, execution duration, observed simultaneous jobs, controller
execution/wait occupancy, resource headroom and metered cost separately. Completed
intervals must overlap for positive duration; adjacent intervals are not overlap.
Resource headroom is Not recorded without resource samples. Missing queue dates
are not zero wait. Measured overlap does not predict a throughput multiplier:
the slowest required shard and prerequisite still bound completion.

Record each exercise and expected versus observed outcome:

| Exercise | Required observation |
| --- | --- |
| Healthy three pools | Hosted receives its intended share while both compatible external nodes execute; no hosted step sleeps/polls solely for an external job. |
| All external nodes offline/queued | Standard hosted still executes the identical owned source/plan; no claim that native GitHub assignment spills between pools. |
| Unavailable after selection | Bounded start deadline, owned-child fencing/cancellation evidence and one authoritative logical outcome. Unknown cancellation is not success. |
| Genuine failing test | Failure remains red; fallback does not retry it into green. |
| Parent cancellation | Only owned child work is stopped/fenced, no unrelated run is cancelled; no aggregate pass after cancellation. |
| Repeated/late events | Deduplication, stale-generation exclusion and unchanged one-result-per-shard ownership. |
| Restart/missed webhook | Durable state and bounded reconciliation restore deadlines; a controller outage keeps the gate conservative. |
| Second compatible node | Fixture first, same group/profile; no machine-name YAML. A second live node needs later approval. |

The hosted submitter must exit after durable acceptance. Inspect actual controller
step intervals; a concurrent registration or a zero-length selected sample does
not prove there is no waiting job. Standard hosted `ubuntu-latest` stays active:
initially at most two external Worker shards per eligible run, and at least one
hosted Worker shard in later stages, with frontend/rest and other hosted-only work
unchanged. Included hosted VMs are provisioned on demand, so they need no permanent
self-hosted entry on the Runners page. Respect the actual hosted concurrency cap.

## Drain and assignment-race handling

1. Stop new admissions to the profile/node and persist the drain fence. Freeze
   ephemeral re-enrollment before touching the current registration.
2. Through the reviewed lifecycle path, remove matching GitHub scheduling
   eligibility and verify it is gone. A private `draining` flag alone is insufficient.
3. Re-read the actual assignment after eligibility removal. An assignment may
   have won the race. Let an active owned job finish within its reserved deadline.
   If it is unrelated or ownership is uncertain, stop teardown and escalate; never
   kill it to make inventory match a target.
4. For an owned job that cannot finish by the documented deadline, use only its
   recorded cancellation/fence policy and verify the outcome. Pending/unknown is
   not permission to destroy a busy machine or publish a pass.
5. Verify no new assignment and that the runner is idle; unregister through the
   separate operator enrollment/removal flow. Clear leaked/stale registration
   records only after identifying their owned machine/job.
6. Stop/delete the actual temporary compute and its approved residual resources.
   Verify provider state and metering after billing lag. GitHub deregistration or
   stopping a service is not proof that billing ended. Keep receipts privately;
   publish sanitized status and observation time only.

## Rollback and growth gates

The reviewed #7887 kill switch stops delegation and restores the intact fully
hosted path without waiving source checks or aggregate authority. Do not guess
its configuration key before it is published. Revalidate one approved bounded
hosted canary; let already admitted work finish/drain or cancel only owned work.
A control-plane outage cannot promise immediate fallback; its checks remain
pending/failed until recovery or the reviewed rollback is verified.

Growth from 1 to 5–10 is a later capacity decision, not permission granted here.
Require measured queue demand, three-pool overlap, tested recovery/drain, sufficient
per-node CPU/memory headroom, verified actual cost and credits/expiry, and reviewed
GitHub/provider API budgets. Name the stage cap, per-profile/per-run limits,
maximum starts per interval, cooldown, warm-up and maximum lifetime. Confirm the
permanent hosted share. The 50-node stage is #7889 and waits on this measured
small-pool proof. Simulated 50-node tests are never described as 50 live runners.

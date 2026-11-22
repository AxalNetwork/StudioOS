# Offline Worker shard replay, 21 November 2026 (#8012)

This dated analysis uses published source `af019ea025334d1d4fb6d365bcd8af9ca3c93fdc`
and compares its inventory with pinned main `c2fb23a5cc4e440268dce3c65c579a0ee21bf469`.
It replays D5609's existing planner for 6, 8 and 12 Worker parts. The output is
an additive prediction from historical file measurements. Hosted elapsed time,
current-source throughput, runner-minute savings and the two-machine pilot's
performance remain unmeasured by this analysis.

## Input and source provenance

The retained input is artifact `14346295606`, named
`test-deps-af019ea025334d1d4fb6d365bcd8af9ca3c93fdc`, from
[run 44110620304](https://github.com/AxalNetwork/StudioOS/actions/runs/44110620304).
GitHub reports 13,983,192 ZIP bytes, creation at 2026-11-17 16:04:31 UTC and
expiry at 2026-12-17 16:04:28 UTC. It was unexpired when retrieved on 21 November.
The recorded run head is the same SHA as both JSON envelopes, on queue branch
`gh-readonly-queue/main/pr-6904-f62f02555232c186a15f3d61e9e05a9d4f25dab5`.
Both envelopes record Node `v22.23.4`, also used for this replay.

| Input | SHA-256 |
| --- | --- |
| ZIP, downloaded bytes matching GitHub's recorded digest | `60db8ccafaa93bd01cc58cd8a5f8db99e1216e00b3cb45051ba0c920ea25012d` |
| `test-timings.json` | `3d5e745cf8688f716cf43a3fc0f0bc4188c00cadd2d86763ab4a207c53e31618` |
| `test-deps.json` | `8b9427c80b609fb49721fc0cf0bdb207e4f04d3ccb8a5b39426ed5c191468401` |

The archive contains exactly those two JSON files. All 4,036 timing rows have
valid nonnegative finite wall times, integer exits, dependency rows and paths
in the historical Git tree. The dependency envelope has 4,036 rows and valid
list/opaque fields. There are zero untraced files. All 1,933 historical Worker
files have positive timings and exit 0. Nineteen have opaque dependency traces
(0.98%); their wall times are present and included. Opaque coverage limits
source-change reasoning. Raw process records are unavailable, so the merged
maximum-per-file values cannot be independently reconstructed from the ZIP.

The six original Worker jobs and the artifact producer are recorded successful
by the jobs API. Job IDs are 134145467507, 134145467622, 134145467431,
134145467514, 134145467533, 134145467551 and 134166994715 respectively. The
connector omits job/step timestamps and runner hardware, so their measured
elapsed durations and setup costs are unknown here.

The replay imports `buildPlan`, `suiteFiles` and `timingsOf` from the archived
historical `scripts/test-drift-parts.mjs`, which calls the existing
`scripts/lib/shardPlan.mjs`. An in-memory shard-count argument selects 6/8/12.
The exact production Worker globs expand over a temporary path-only projection
of the historical Git inventory. Empty projection files support enumeration
only. Test code is never executed by the replay.

`shardPlan.mjs`, `merge-test-deps.mjs`, `test-tracer.mjs` and D5609 have identical
Git blob identities in historical and pinned current source. Current
`test-drift-parts.mjs` additionally supports queue equal weights and failure
annotations. Its queue policy deliberately uses equal weights for a plan that
depends only on the commit. This offline measured comparison does not establish
that a live queue run used these measured assignments.

Published support heads #7981 `db11f2f3da613f3542d2bf8f736acaa35735457d` and #7972
`513da8c5bf32eda4a4e8818f6fbbcd9bed63275c` change capacity retention and execution
authority respectively. Their planner, drift runner and trace-merger files
match pinned main. No part of those branches is integrated by this report.

## Historical comparison

Each row covers the same 1,933 measured files, zero unknown durations and 19
opaque dependency traces. Total additive work is 12,477,977 ms (207.97 minutes).
`parts.csv` records every part's file count and predicted load in milliseconds.

| Parts | Per-part additive loads, minutes, in part order | Maximum, minutes | Median, minutes | Max minus median, ms | Max / median |
| --- | --- | --- | --- | --- | --- |
| 6 | 34.661, 34.662, 34.661, 34.661, 34.662, 34.661 | 34.662 | 34.661 | 66 | 1.00003174 |
| 8 | 25.996, 25.995, 25.996, 25.996, 25.996, 25.996, 25.996, 25.995 | 25.996 | 25.996 | 10.5 | 1.00000673 |
| 12 | 17.330, 17.331, 17.330, 17.331, 17.330, 17.331, 17.331, 17.331, 17.331, 17.331, 17.331, 17.331 | 17.331 | 17.331 | 6.5 | 1.00000625 |

These maxima are the estimated critical paths **under the additive model**,
assuming files run serially within a part and all parts start simultaneously.
Eight parts reduce that model's maximum by 25.00% from six; twelve reduce it by
50.00%. This near-linear scaling follows from balanced packing of a fixed sum.
It cannot establish actual speedup under Node file concurrency, shared runner
limits, heterogeneous CPUs or queue pressure. The longest measured file is
420,580 ms, a 7.010-minute indivisible duration in this retained sample. Its
future duration under another allocation remains unknown.

For an equal-weight assignment generated by the same historical planner,
then evaluated with these measured file durations, maximum additive loads are
46.619, 36.095 and 35.564 minutes for 6/8/12 respectively. Measured packing
reduces the six-part additive maximum by 25.65% in this in-sample comparison.
That makes a same-count comparison worth prioritizing before increasing
fan-out. Reusing a sample to fit and score its packing is optimistic, so an
independent later sample is needed.

The longest retained files are listed below. The JSON includes the top 20.

| Worker test file | Wall seconds | Opaque trace |
| --- | --- | --- |
| `branch_freeze_admin_acts_d260.test.ts` | 420.580 | yes |
| `partner_invitation_fixes_d924.test.ts` | 330.529 | no |
| `branch_emergency_sign_out_d4669.test.ts` | 321.479 | yes |
| `deck_share_null_limit_d895.test.ts` | 263.767 | no |
| `grow_writes_d691.test.ts` | 260.908 | no |
| `sub_cutoff_restores_d190.test.ts` | 257.691 | no |
| `kyc_people_queue_d1229.test.ts` | 234.733 | no |
| `branch_unbind_admin_d262.test.ts` | 194.255 | no |

## Pinned current inventory

Pinned main has 2,056 Worker files, comprising 123 new files, 226 changed test
blobs and 1,707 identical test blobs. No historical Worker file was removed.
The timing inventory therefore misses 123 current paths, and its measurements
are stale for at least the 226 changed test files. Of the 1,707 identical test
blobs, 1,590 read a recorded path or directory that changed between the source
trees. The remaining 117 are candidates for inspection; the traces do not
prove identical generated inputs, dependency versions, runtime or hardware.

`inventory.json` contains the full new, removed, changed, identical, dependency-
affected and opaque path lists. Direct/dependency source comparison uses Git
mode/type/blob identity. Directory reads conservatively invalidate on any
changed descendant. Every changed test is excluded from any current estimate
because **no current-duration prediction is produced**. Historical timings are
used solely with their matching historical inventory.

D5609's existing unknown weighting is the suite's p90 among positive finite
durations, with 1 per file when none are known. Zero, negative, nonfinite and
nonnumeric values are unknown. Historical Worker p90 is 9,640 ms. This sample
has no unknown Worker duration, so that fallback does not affect these plans.
Blindly applying historical timings to current files would still treat the
226 edited paths as measured and assign p90 to 123 additions. This report does
not make that substitution. A future collector/planner decision needs an
explicit freshness policy for changed tests, dependencies and opaque traces.

## Measurement boundaries and follow-up

The tracer writes `Math.round(performance.now())` at each test process's exit.
The merger retains the maximum root-process wall time for each test, merges
dependency observations across records and records the maximum exit code.
The artifact does not retain repetitions or per-file CPU time. Default Node
test concurrency allows file durations to overlap and contention to inflate
them. Consequently, 207.97 additive minutes cannot be reported as runner-minutes,
and tiny predicted spreads cannot prove D5609's three-run 15% hosted criterion.

The historical workflow installed frontend, Worker and root dependencies and
built the SPA before each suite part. Pinned main omits frontend installation
and SPA build for Worker parts (D7108). Those top-level stages, checkout,
runner wait, generated-module preparation and artifact transfer are outside
individual file timings. Loaders and test setup, child work awaited by a test,
and SQLite migrations executed inside its test process contribute to that
file's wall time. Their separate stage costs are unavailable. This analysis
does not measure production D1 migration time.

Recommended experiments for the parent owner, after the existing operational
gates and approval, are as follows. None is launched by this work.

1. Keep six Worker parts and the first-milestone two-Linux plus four-standard-
   hosted allocation. Capture an independent trace and per-job queue, install,
   generation, test and cleanup times on identical source/hardware profiles.
   Compare measured packing with equal-weight packing. The in-sample maximum
   load difference is 11.96 additive minutes (25.65%); actual elapsed benefit
   is unknown. This tests packing value without increasing shard count.
2. Inspect the eight longest files and their shared SQLite setup. Their
   retained process durations span 194–421 seconds. Separating setup from
   assertions would identify whether repeated migration/bootstrap work is the
   long tail; the longest-file model floor is 7.010 minutes. Preserve test
   coverage, isolation and thresholds. This report recommends measurement,
   not a test rewrite or timeout change.
3. Only after the six-part pilot proof, compare 8 and 12 parts on a pinned fresh
   inventory across three independent samples. The additive ceiling improves
   by 8.67 and 17.33 minutes versus six, with two or six additional setups per
   run. If setup costs S minutes per part, aggregate setup adds 2S or 6S.
   More than six available execution slots, queue delays, runner profiles and
   per-process concurrency must be measured before claiming either saving.
   Keep the free standard-hosted share and all existing admission/cleanup gates.

## Reproduction and verification

The checkout must contain the two pinned commits and historical script blobs.
Retrieve the artifact with ordinary `actions:read` repository access before
expiry, or retain the verified ZIP externally. Raw dependency JSON and the ZIP
are outside this delivery directory. Signed download URLs are omitted.

```sh
export AGENT_ENGINE=off
gh api repos/AxalNetwork/StudioOS/actions/artifacts/14346295606/zip > /tmp/artifact-14346295606.zip
node --max-old-space-size=4096 documentation/audits/worker-shards-2026-11-21-8012/replay.mjs \
  . /tmp/artifact-14346295606.zip /tmp/worker-shards-8012-output
```

Use Node 22.23.4, Git, tar and unzip. The replay verifies the ZIP checksum,
envelope/source identity and row shapes, enumerates the matching Worker glob,
checks exact-once coverage through the original guard and compares repeated
plans including reversed timing-key order. The temporary projection is removed
on completion. The output files can be compared byte for byte between runs.
It never invokes a test command, workflow, planner CLI execution mode or model.

The historical planner's four existing fixture tests pass, including unknown
weights and missing/extra/duplicate coverage rejection. Two independent replay
invocations produce identical JSON/CSV/plan bytes. A modified ZIP is rejected
before replay. Syntax, decision IDs and whitespace checks are also recorded in
`validation.json`, which retains actual exit codes and the local harness error.
Full test:drift, build, Worker types and hosted CI are not run for this analysis
artifact. Publication remains under the #5719 hold.

## Files

| File | Purpose |
| --- | --- |
| `replay.mjs` | Read-only Git/artifact replay using the historical D5609 implementation. |
| `summary.json` | Provenance, source identities, all predicted loads, spread, top files and limits. |
| `inventory.json` | Complete historical/current Worker inventory differences and opaque coverage. |
| `parts.csv` | One row per part across the three counts, with both assignment comparisons. |
| `plan-6.json`, `plan-8.json`, `plan-12.json` | Offline Worker assignments and original reconstructed commands. |
| `validation.json` | Executed checks and exit codes, including expected rejection and harness failure. |

Agent S35 / Codex / session s35. Preparation evidence for #5609 and #5506;
live pilot and parent closure remain with their owners.

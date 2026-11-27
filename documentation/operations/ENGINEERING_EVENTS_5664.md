# Engineering event capture evidence — 12 November 2026 (D5664)

This is a metadata-only, read-only pilot using GitHub REST; it sent no Slack
messages, dispatched no workflows and installed no App. The deployment proposal
is disabled. Coverage at main 8ef2ebd1e7 is versioned in
[coverage-v1.json](../../engineering-notifications/coverage-v1.json).

| Family/source | Observed records | Limits and discrepancies |
| --- | ---: | --- |
| Committed workflows | 41 | All current `.yml` files; historical issue snapshot counted 40. |
| Registered workflows | 50 | All registration pages; nine paths absent from this checkout, retained individually in inventory. |
| Runs | 100 | Newest page only, total_count 40,000; not a whole-history completeness claim. 62 success, 16 skipped, 8 cancelled, 3 failure, 9 in progress, 2 queued. |
| Open PRs | 30 | Current open snapshot; intermediate review/head/queue transitions require the approved event feed. |
| Issues/PR issue records | 100 | First page; historical issue recovery not verified. |
| Deployments | 100 | First page; historical status/approval reconstruction not verified. |
| Current-commit checks | 41 | Observed provider `github-actions`; absent providers are unknown, not assumed unsupported forever. |
| Sample run jobs | 1 of 1 | Run/attempt 43193844583/1, job 131099621837; only IDs/states/step outcomes read. |
| Capture rejects/redacted source records | 0 / all normalized records | No unsigned live ingress was enabled. Whitelist redaction is applied before durable acceptance; this is not a count of discovered secrets. |
| Restricted security scope | Not verified | Disabled pending separate approval under #5668; no findings retrieved. |

[Sample run](https://github.com/AxalNetwork/StudioOS/actions/runs/43193844583)
and [job](https://github.com/AxalNetwork/StudioOS/actions/runs/43193844583/job/131099621837)
provide correlation evidence. Source endpoints were workflow registrations,
all-workflow runs, open pulls, issues, deployments and current-main check runs.
The runtime exposes aggregate per-family counts, rejected categories, applied
redactions, pending attempts and explicit gaps through internal read-only RPC.
There is no public history endpoint and no GitHub mutation transport.

Before rollout, #5668 must approve the isolated Worker/Queues/Durable Object
resources and App repository/installation IDs, minimum read scopes, signed
webhook registration, heartbeat destination, restricted security boundary,
retention/deletion policy and canary. Actions and work/delivery/provider/claim snapshot recovery are implemented
locally; their scoped live feed/recovery proof remains outstanding. Neither #5639 nor StudioOS deployment availability gates
fixture capture or the independent proposed schedule.

Failed deliveries need authorized replay from retained GitHub delivery records;
GitHub does not automatically resend them. Keep capture and reconciliation
kill switches false until installation is verified. A source gap is owned by
S01/infrastructure; restore scope or replay approved retained deliveries, then
reconcile overlapping windows. Never erase immutable history to make counts
match. No retention expiry is implemented or claimed before an owner policy.

At an approved deployment only, the normal capture Worker needs `WEBHOOK_SECRET`
and the minimum-scope `GITHUB_READ_TOKEN`. The separate security deployment
needs its own `SECURITY_WEBHOOK_SECRET` and installation; it does not inherit the
normal reader credential and its REST reconciliation stays disabled. These are
independent service secrets, not StudioOS production bindings. No values belong
in configuration, fixtures, logs or the registry. Both configurations include a
durable anonymous ingress budget and remain disabled until #5668 approves them.

The read-only source exposes independent event and gap cursors. Gap intervals
are itemized through the publisher with an unknown missing-record count; a
single discrepancy is never presented as a known number of lost events.
Aggregate gap output is bounded and includes total/truncation information;
internal paginated gap history retains every recorded interval.

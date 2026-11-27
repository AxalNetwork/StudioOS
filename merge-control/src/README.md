# Merge Control source

| File | Purpose |
| --- | --- |
| `index.ts` | Public ingress and authenticated owner routes, Queue and cron handlers. |
| `webhook.ts` | Bounded raw-body HMAC verification and owner token checks; D5990: pull_request and checks_requested deliveries carry head, base and number. |
| `repoControl.ts` | One object per repository: durable deduplication, issue leases, append-only audit and reconciliation; D5990: one policy decision per SHA and `policy_version`, posted as the `merge-control/policy` check run. |
| `github.ts` | Short-lived GitHub App installation token and bounded GitHub API client; D5990: the policy check's separate `checks: write` scope. |
| `policy.ts` | D5620: the bundled landing-policy classifier and `policy_version`, the deployed commit injected with `wrangler deploy --define`; a build without it refuses to load. |
| `policyCheck.ts` | D5620: fail-closed `evaluate({base, head})` over the compare file list; cap, missing patch, API error, exception and timeout are T2. D5990: `policyTarget`, `decide` (a T2 merge-group head passes only on D8834 sign-off evidence) and `checkRunBody`. |
| `signoff.ts` | D8834: the owner-only `POST /signoff` route, the exact head-SHA sign-off key, and the evidence that binds a T2 merge-group candidate to its signed pull request head. |
| `types.ts` | Delivery/run contracts and generated bindings plus owner-installed secrets. |
| `lib/` | Pure cancellation and fencing policies. |
| `runnerScaleProvider.ts` | D7889: unavailable live-provider boundary and bounded, checkpointed inventory collection; no provisioning API is enabled. |
| `ciCapacity.ts` | D7887: inactive durable capacity coordinator core and isolated SQL store; injected verified adapters. |
| `ciCapacityCompact.ts` | D8348: compact record of a passing request, its projection, table, sticky failure and bounded expiry through an explicit consumer. |
| `ciCapacityRetention.ts` | D8339, D8348: read-only publication evidence (owed, revisable, final) for full requests and compact records, composed by the disabled runtime. |
| `ciCapacityAuth.ts` | D7973: bounded signed GitHub OIDC identity and body reads. |
| `ciCapacityGithub.ts` | D7973: bounded App-backed provenance, inventory, dispatch, observation and cancellation ports. |
| `ciCapacityTransport.ts` | D7973: authenticated exact-plan submission and owned receipt retrieval. |
| `ciCapacityCorrections.ts` | D7909-p8: durable negative-publication due set, bounded legacy discovery and fail-closed backfill readiness. |
| `ciCapacityOutbox.ts` | D7973: durable publication intents and distinct pilot/full-suite authority. |
| `ciCapacityRuntime.ts` | D7973: unbound inactive capacity object, independent switches and alarm recovery. |
| `ciCapacityHistory.ts` | D7909-p8: bounded cursored collection retains full, compact and pending-negative dependent evidence. |
| `ciCapacityReconciliation.ts` | Owner inspection of outstanding publication evidence and compare-and-set adoption of an independently observed check (#8376). |

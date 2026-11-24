# Merge Control source

| File | Purpose |
| --- | --- |
| `index.ts` | Public ingress and authenticated owner routes, Queue and cron handlers. |
| `webhook.ts` | Bounded raw-body HMAC verification and owner token checks. |
| `repoControl.ts` | One object per repository: durable deduplication, issue leases, audit and reconciliation. |
| `github.ts` | Short-lived GitHub App installation token and bounded GitHub API client. |
| `policy.ts` | D5620: the bundled landing-policy classifier and `policy_version`, the deployed commit injected with `wrangler deploy --define`; a build without it refuses to load. |
| `policyCheck.ts` | D5620: fail-closed `evaluate({base, head})` over the compare file list; cap, missing patch, API error, exception and timeout are T2. |
| `types.ts` | Delivery/run contracts and generated bindings plus owner-installed secrets. |
| `lib/` | Pure cancellation and fencing policies. |
| `runnerScaleProvider.ts` | D7889: unavailable live-provider boundary and bounded, checkpointed inventory collection; no provisioning API is enabled. |
| `ciCapacity.ts` | D7887: inactive durable capacity coordinator core and isolated SQL store; injected verified adapters. |
| `ciCapacityCompact.ts` | D8348: compact record of a passing request, its projection, table, sticky failure and bounded expiry; inactive until a consumer is supplied. |
| `ciCapacityRetention.ts` | D8339, D8348: read-only publication evidence (owed, revisable, final) for full requests and compact records; not yet wired into the runtime. |
| `ciCapacityAuth.ts` | D7973: bounded signed GitHub OIDC identity and body reads. |
| `ciCapacityGithub.ts` | D7973: bounded App-backed provenance, inventory, dispatch, observation and cancellation ports. |
| `ciCapacityTransport.ts` | D7973: authenticated exact-plan submission and owned receipt retrieval. |
| `ciCapacityOutbox.ts` | D7973: durable publication intents and distinct pilot/full-suite authority. |
| `ciCapacityRuntime.ts` | D7973: unbound inactive capacity object, independent switches and alarm recovery. |

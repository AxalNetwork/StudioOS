# Engineering Slack rollout acceptance (#5668)

**Decision: hold activation.** The public acceptance record is [#5668](https://github.com/AxalNetwork/StudioOS/issues/5668). Keep the operator inventory and workspace evidence in controlled configuration.

## Evidence available for review

- The [historical fake-transport rehearsal](https://github.com/AxalNetwork/StudioOS/issues/5668#issuecomment-6825682599) reproduced the census of 1,251 Actions runs, including 120 CI runs and 2,712 latest-attempt CI jobs. Its twice-mean-rate replay produced 5,943 searchable rows and 241 fake acknowledgements. It recorded one gap whose missing-record count is unknown. [#5699](https://github.com/AxalNetwork/StudioOS/pull/5699) merged the terminal-event deduplication fix.
- On `dc54b6e6f982921f7207b21e51f2297643277ec3`, the 65 existing source, routing, delivery, health and restricted-transport tests passed. The replay exercised the outbox directly. Integrated scheduler capacity, live receipt latency and fallback operation during a Slack outage remain unmeasured.

## Approval record

- [ ] Workspace administrator and destination owners approve the versioned routing inventory, access, retention, native-subscription overlap, ownership and fallback. Record only approval status and references cleared for publication on #5668.
- [ ] Replay the historical census through the integrated scheduler at the measured and twice-mean rates. Compare observed, recovered, delivered, redacted, duplicate, pending and unrecoverable counts by family, source and outcome. Correlate immutable source items with delivery receipts. Account for ambiguous sends and missing transitions explicitly.
- [ ] Exercise recovery for outages, throttling, late source events, restarts, lost access and missed schedules. Confirm zero audience leaks and verify independent reporting while Slack is unavailable.
- [ ] After owner approval, dry-run and then canary one route at a time. Compare GitHub receipts and the [CI scorecard](https://github.com/AxalNetwork/StudioOS/issues/5603). Verify observation-to-receipt p95 against the issue's 2-minute incident and 10-minute routine targets, and measure source-to-observation separately. Record backlog, throttling, API budget, channel volume, event cost and incremental runner time.
- [ ] Confirm that acceptance is tied to the tested configuration, that cutover has one publisher per route, and that the owner can disable delivery while preserving source and incident state. Follow the [sender recovery procedure](ENGINEERING_SLACK_5665.md). Production activation requires a subsequent change.

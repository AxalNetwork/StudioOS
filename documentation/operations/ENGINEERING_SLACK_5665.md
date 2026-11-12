# Engineering Slack rollout and recovery — D5665

No live destination is configured. #5668 owns approved team/channel IDs, bot
invitation/scopes, retention, heartbeat observer and a reconciled canary. Proposed
role names are not evidence of real channels. The native GitHub Slack app remains
a separate opt-in; this work installs no subscription.

| Control | Effect |
| --- | --- |
| `DELIVERY_ENABLED=false` | Stops actor sends/alarms globally; durable intents stay recorded. |
| Registry `channels.<role>.enabled=false` | Holds only that role's messages; never redirects them. |
| Registry channel ID change | Existing queued intents become dead rather than changing destination silently. |
| Registry retentionDays | Refuses expired ingestion and queued sends; does not authorize physical deletion. |
| Ambiguous/dead state | Operator reconciles exact logical key with approved channel/receipt; no blind replay. |

Before enabling, confirm the reviewed registry, auth.test team ID, channel IDs,
privacy/membership/retention, internal bot scopes and one publisher per route.
Only the internal service-binding entrypoint accepts metadata. Keep all public
URLs without an enqueue route. No file scope is needed; large batches use pages.

For the canary, reconcile ledger eligible event keys against activity item/page
keys and returned channel/ts receipts. Check hourly roots, nonempty five-minute
index/page counts, 100 jobs/two attempts, a cancellation, recovery within a batch,
PR root edit and restricted channel access. Simulate 429 and accepted timeout in
the fake API first. Never count queued acceptance as a Slack receipt. Log only
state/counts, not payloads, tokens, URLs or Slack error bodies.

On failure, retain GitHub source issues and metadata ledger, disable the affected
role, inspect pending/retry/dead/ambiguous counts through internal summary, then
repair invitation/scope/registry under #5668. Respect Retry-After and do not send
to another channel. Unknown accepted sends need an approved Slack receipt before
manual acknowledgement/replay. The current code deliberately supplies no public
replay or receipt-forging endpoint. If old health webhooks were used, keep their
acknowledgements and absent timestamps honest; drain known pending keys once,
turn their publisher off, and only then enable the internal bot. An ambiguous
legacy key is a reconciliation task, not permission to duplicate a message.

An independent observer must read the sender health/aggregate summary and keep a
GitHub-visible heartbeat/escalation under separately approved privileges. The
sender itself has no GitHub write token. Until #5668 configures that observer and
records the canary, neither fallback availability nor live delivery is verified.

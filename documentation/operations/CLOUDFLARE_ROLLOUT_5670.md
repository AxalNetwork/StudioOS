# Cloudflare notification acceptance (#5670)

Inventory: `engineering-notifications/cloudflare-coverage-5670.json`.

1. #5671: verify team/channel ID, privacy, Slack Connect, current bot grants,
   retention, responder and fallback privately. Configure a primary publisher
   per route. Enter webhook/header secrets in provider secret stores only.
2. Test the provider's Save and Test separately from a real alert episode.
   Keep its acknowledgement, receiver checkpoint and actual Slack receipt
   distinct. A generic test payload does not prove production monitor scope.
3. Prove preview firing/recovery and no production-channel message. Verify
   native policy scope, Issues sampling/opt-in and sanitized payload fields.
4. Enable one approved production family at a time. #5672 handles runtime,
   cron, queues, Workflow and dependency evidence. #5673 owns versions and
   release correlation; #5674 recording; #5675 preview callbacks; #5676 archive.
5. Record source/key/window/version, eligible and duplicate counts, durable
   intent, destination receipt, repeated episode and healthy recovery.
   Publish redacted counts only; private links must check reader permission.
6. Exercise 429, timeout after acceptance, restart, missed heartbeat and
   unavailable telemetry. Keep uncertain sends unresolved, never green.
7. Verify per-route mute plus an independent fallback outside this sender's
   failure domain. Roll back delivery without changing checks, claims,
   incident history, queues, storage lifecycle or release state.

Production thresholds, sample floors, cost, owners and canary receipts remain
Not recorded until verified. Quiet/idle is not missing data or healthy proof.

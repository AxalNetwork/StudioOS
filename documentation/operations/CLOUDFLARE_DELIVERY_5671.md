# Cloudflare delivery: configure, verify and recover (#5671)

Both receiver and observer default disabled. This procedure is not delivery
evidence. Read [D5671](../architecture/decisions/D5671.md) and the
[existing sender procedure](ENGINEERING_SLACK_5665.md). Keep actual configuration,
audience checks and receipts in the authorized private operational system.

## Private configuration

1. Verify workspace, distinct channel IDs, bot membership, recipient access,
   external sharing, retention, responder and fallback for all three routes.
   Channel names and product roles alone are not grants. Use one primary
   publisher per route; preserve the unrelated Images email policy.
2. Store `SLACK_BOT_TOKEN`, `CF_WEBHOOK_SECRET` and `CF_OBSERVER_SECRET` as Worker
   secrets. Webhook and observer secrets must be separate random values of at
   least 32 characters. GitHub's independent observer gets only its own
   `CF_OBSERVER_SECRET`. Never paste credential values into issues or logs.
3. Set private `ROUTING_REGISTRY` using the sender's schema 1: approvedAt,
   version, reviewedBy, teamId and channels. Add purpose
   `cloudflare-notifications`, slackConnect false, recipientAccessVerified true.
   Require exactly health/activity/prs aliases with routeRole respectively
   `cloudflare-health`, `cloudflare-activity`, `cloudflare-preview`. Each needs
   its own approved id, private true, explicit enabled, publisher `internal-bot`
   and approved retentionDays. `prs` is an internal engine alias for Cloudflare
   preview; it must not point to a GitHub destination.
4. Set private `PROVIDER_REGISTRY`: reviewed true, exact accountId, and policies
   keyed by exact policy ID. Each needs alertType, script, component,
   environment, summaryApproved true, sourceScopeVerified true, sensitivity
   `operational`, and phaseMap from verified provider states to
   firing/repeat/recovery/observation. Fixture START/END/INFO are not provider
   enums. Approve the actual policy script filter. Only the preview bot uses
   preview; studioos, the production bot and studioos-tail use prod.
5. Review/bundle the independent `wrangler.cloudflare-5671.jsonc` config,
   migration, cron and resource costs. No public route is configured and
   workers_dev is false. Configure an approved HTTPS route before registration.
   The current observer supports only a workers.dev `/status` URL; enabling
   that hostname requires an explicit config change. Custom-domain observation
   requires code support. `/health` reports configuration, not delivery health.

## Canary and receipts

- Verify the requested channel-bound incoming-webhook baseline in Slack using
  the authorized app/admin workflow. The connected Slack tool cannot create
  that credential. Enter its URL directly into Cloudflare's destination field.
- Configure the receiver destination's exact generic `cf-webhook-auth` secret.
  Authenticated text-only Save and Test gets HTTP 200, accepted false, probe
  true, with no intent or Slack send. Missing/wrong authentication gets 401.
- Enable only approved preview routing first and originate a registered policy
  episode. Verify one Slack root, immutable firing/repeat replies and latest
  recovery. Native acknowledgement, durable HTTP 202 and a Slack receipt are
  separate facts. Verify zero production messages from preview.
- Replay duplicate and reversed notifications. Interrupt after durable
  acceptance, restart and reconcile item keys with acknowledged receipt keys.
  Keep uncertain sends ambiguous until reconciled; do not blindly resend them.
- Exercise burst pagination, 429/Retry-After, oldest undelivered age and dead
  intents with a synthetic authorized transport before a live outage drill.
  Exercise sharing/membership changes: refusal must not fall back elsewhere.
  Preserve the actor and checkpoint; never clear an alarm by deleting them.

## Independent detection and rollback

Set GitHub `CF_STATUS_URL` and `CF_HEARTBEAT_ENABLED` after the private status
read works. Reading status never advances lastScheduledAt. The observer reports
a schedule older than 15 minutes or pending delivery older than 10 minutes;
missing or failed telemetry is unknown. Its fixed GitHub check failure is the
independent fallback surface. Verify a subscribed owner actually receives and
responds during a Cloudflare/Slack outage before relying on it.
`CF_HEARTBEAT_MAINTENANCE` explicitly marks maintenance, not recovery.

Set `CF_DELIVERY_ENABLED` false to stop ingress/sending; individual registry
enabled flags mute routes. Also disable the originating provider policy.
Preserve durable state and reconcile pending, ambiguous and dead intents before
restoring. Approve a retention/deletion procedure before production traffic:
automatic event/receipt cleanup is not implemented here.

For each family, privately record policy/filter, owner, freshness/window,
baseline/denominator, eligible and receipt counts, gaps, latency, daily volume,
firing/recovery receipts, access checks, outage/replay and mute/restore results.
Version/count/last-good remain explicitly unrecorded until trusted producers
supply them. #5667 owns release threads; #5672–#5676 own source acceptance.

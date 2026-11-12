# engineering-notifications — independent metadata capture (D5664)

This service is independent of StudioOS deployments and Actions runner health.
It is disabled by default. #5668 owns App installation, resource approval,
channel inventory and the live canary. It has no GitHub write API or Slack token.
Read [D5664](../documentation/architecture/decisions/D5664.md) before rollout.

| File | Role |
| --- | --- |
| `events-v1.mjs` | Versioned metadata-only contract, SHA roles, redaction and semantic keys. |
| `ingress.mjs` | Bounded signed-byte ingress, installation/repository/event allowlists and durable queue acceptance. |
| `ledger.mjs` | Append-only event/delivery history, cursors, discrepancies and rejection counts. |
| `reconcile.mjs` | Overlapping, split REST windows, read-only rate-aware transport and explicit gaps. |
| `github-source.mjs` | All-workflow Actions run/attempt/job REST reconciliation adapter. |
| `worker.mjs` | Separate Worker, visibility-partitioned SQLite Durable Objects, queue consumer and independent schedule. |
| `wrangler.jsonc` | Inactive deployment proposal; resource names are proposed, not provisioned. |
| `coverage-v1.json` | Dated workflow/provider IDs, permissions, scope owners and supported/unsupported recovery matrix. |

| `snapshots.mjs` | D5664: GET-only PR/review/issue/check/status/deployment/release/ref/claim recovery with explicit unrecoverable gaps. |

| `wrangler.security.jsonc` | D5664: separately disabled security Worker/Queue/ledger proposal; normal ingress cannot accept security events. |
| `cloudflare-receiver-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-outbox-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-transport-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-worker-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `wrangler.cloudflare-5671.jsonc` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-heartbeat-5671.mjs` | D5671: bounded private status reads and missed-schedule/undelivered-age evaluation. |

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

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
| `cloudflare-coverage-5670.json` | D5670: dated four-script/six-family coverage and acceptance inventory. |
| `cloudflare-receiver-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-outbox-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-transport-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-worker-5671.mjs` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `wrangler.cloudflare-5671.jsonc` | D5671: authenticated Cloudflare metadata, private route delivery and disabled independent receiver. |
| `cloudflare-heartbeat-5671.mjs` | D5671: bounded private status reads and missed-schedule/undelivered-age evaluation. |
| `platform-policy-5672.mjs` | D5672: conservative aggregate policy and observational shared-episode presentation. |

## Actions workflow channels

[`workflow-channels.json`](workflow-channels.json) lists the GitHub registration ID,
path and Slack hashtag for each workflow. It includes GitHub-managed workflows
and active registrations whose files no longer appear on the default branch.
The two managed CodeQL registrations have the same display name and distinct IDs
and channels. The Slack publisher uses the ID and a separately configured
private destination. See the [private registry and activation steps](../documentation/operations/WORKFLOW_SLACK_6370.md).

When adding a workflow, include its path and proposed hashtag in the same PR.
Use `null` for its ID until GitHub registers it. Once it is registered, populate
the numerical ID from GitHub's Actions API, provision the private Slack channel,
and configure its verified channel ID with the sender. On rename, retain the
workflow's established channel where appropriate and check the current GitHub ID.
Check the API before removing a route for a deleted file. Keep routes for active
registrations even if their YAML is gone. For a disabled or deleted registration,
account for the last attempts and outstanding receipts before retiring its route.

The frontend test suite checks new YAML coverage and duplicated names, IDs and
paths offline. Reconcile against every provider registration after a workflow
change or when the sender reports an unmapped workflow:

```sh
gh api --paginate --slurp 'repos/AxalNetwork/StudioOS/actions/workflows?per_page=100' > /tmp/studioos-actions-workflows.json
STUDIOOS_ACTIONS_WORKFLOW_SNAPSHOT=/tmp/studioos-actions-workflows.json node --test frontend/test/workflow_channel_inventory.test.mjs
```

# GitHub Actions repair issues

After this change lands on `main`, the existing **GitHub alerts** workflow checks for actionable completed runs every five minutes. GitHub supplies the job's token. The repository's label sync workflow provisions `workflow-failure` from `.github/labels.yml`. The reporter checks that the label exists before creating a new generic issue and retries on a later sweep if label sync is still queued. The reporter uses Actions, Checks and Contents read access plus Issues write access. It operates independently of Slack.

New repair issues enter the S01 triage queue with `bug`, `ci`, `workflow-failure` and `state:ready`. Main-branch and startup failures receive `priority:high`; other failures receive `priority:medium`. Repeated failures are recorded in compact, dated comments on the open issue.

A failure, timeout, startup failure or action-required conclusion is eligible. For a known operational failure, the reporter adds evidence to the matching open repair issue. A positively identified superseded release is ignored. Older releases without the trusted marker remain available for triage. A failed admission check without that evidence remains actionable. Normal skips, cancellations, successes and neutral results generate no bug. Security finding details stay with the existing security-reporting path. An operator who confirms critical production impact can promote the repair to `priority:P0`.

## Enable the signed event path

1. On the Axal VC Cloudflare account, create the queues `studioos-workflow-failures` and `studioos-workflow-failures-dead`. Deploy only the independent Worker described by `engineering-notifications/wrangler.workflow-failures.jsonc`. Its rate limit, queues and credentials are separate from the production app and Slack.
2. Set `WEBHOOK_SECRET` to a new private signing secret on the Worker. Set `WORKFLOW_DISPATCH_TOKEN` through Cloudflare's private secret configuration to an expiring credential scoped to this repository with Actions write access. It is used only for dispatching `github-alerts.yml` on `main`. Rotate it before expiry. Do not put either credential in the repository, issues or logs.
3. Create a JSON repository webhook subscribed to **Workflow runs**. Use the Worker's HTTPS URL ending in `/github`, the same signing secret and SSL verification. Confirm the ping succeeds. The signature and immutable repository ID must match before queuing anything.
4. For a naturally failed workflow, verify a webhook delivery returned HTTP 202, a `GitHub alerts` dispatch ran on `main`, and a new or existing issue contains the exact run/attempt link. A 202 confirms queue admission only. Replay the same attempt and confirm it creates no second issue. Benign completions return HTTP 204. Keep webhook, queue and GitHub timestamps separate when measuring time to issue.

## Recover or pause

Use a manual dispatch with an actual run and attempt to replay a missed failure, including a rerun of an old workflow. The reporter fetches the evidence again from GitHub. This example uses shell variables populated from the attempt URL:

```sh
gh workflow run github-alerts.yml --repo AxalNetwork/StudioOS --ref main \
  -f check=workflow-failures -f run_id="$RUN_ID" -f run_attempt="$ATTEMPT"
```

Check failed reporter runs, GitHub queue health, cache availability and the Cloudflare dead-letter queue if an issue is missing. A failed collector, revoked credential or failed write can delay reporting. Without a saved checkpoint the scheduled sweep starts with the last hour of newly created runs. GitHub indexes runs by creation time. Each pass also revisits unfinished runs and scans two hours of older creations within the 30-day rerun period. At the ideal five-minute cadence the historical sweep takes about 30 hours. Exact-attempt webhook dispatch or manual replay avoids that delay. Cache eviction resets the bootstrap boundary. Failures preceding the boundary can be replayed explicitly. Confirm the final issue link after recovering a delivery. For a rollback, disable the repository webhook and revert the workflow-failure job/timer without disabling the existing queue, main-CI or security alerts.

# Activate per-workflow Slack delivery

The [workflow catalog](../../engineering-notifications/workflow-channels.json) maps GitHub's numerical IDs to hashtags. Use the private Slack bot configuration for the destination IDs. The [sender decision](../architecture/decisions/D6370.md) describes the event, deduplication and recovery contracts.

## Build a private routing registry

1. Invite the intended internal sender bot to the existing private workflow channels. Its Slack installation needs `groups:read` and `chat:write`. Confirm the owning workspace, reviewer approval timestamp, route retention and initial canary channel with the operator. Retention here controls the sender's delivery window. Slack message retention has its own workspace policy.
2. In a trusted shell, obtain `SLACK_BOT_TOKEN` from your secret manager and export it for the command. Supply an existing registry with `--base` on every update. Use a new output file in a private directory outside the checkout. Example for an initial CI canary:

   ```sh
   umask 077
   private_dir=$(mktemp -d)
   node scripts/build-workflow-slack-registry.mjs \
     --team "$SLACK_TEAM_ID" --retention-days "$ROUTE_RETENTION_DAYS" \
     --approved-at "$REGISTRY_APPROVED_AT" --reviewed-by guillaumelauzier \
     --enable '#axalvc-actions-ci' --out "$private_dir/registry.json"
   ```

   The command reads the authenticated bot's memberships, validates private/internal destinations against the exact catalog hashtags, and reports counts. A new registry starts with all routes held unless you select a canary. Repeated `--enable` arguments select the complete set of enabled workflow routes. Without `--enable`, an update preserves current enablement. Other channel roles and registry settings are carried forward. Missing memberships may be staged, but selecting an unavailable channel fails the command. Use `--enable all` for rollout when the bot can reach every registered channel. A changed Slack channel ID requires reconciliation before rebinding.

## Connect and verify

1. Provision the capture queue, dead-letter queue and ledger actor from `engineering-notifications/wrangler.jsonc`. Configure the actual repository and installation IDs, with the repository visibility matching GitHub. Enable `CAPTURE_ENABLED`, serve the receiver at the GitHub App's HTTPS webhook URL ending in `/github`, configure the same `WEBHOOK_SECRET` on both ends, and subscribe the App to workflow runs with Actions read access. Preserve other existing subscriptions. To recover missed events, configure the existing read-only `GITHUB_READ_TOKEN` and `RECONCILE_ENABLED` per the [capture runbook](../../engineering-notifications/README.md).
2. Deploy the sender with the `ENGINEERING_EVENTS` service binding and `OUTBOX` actor from `engineering-slack/wrangler.jsonc`. Supply the generated JSON file as the complete `ROUTING_REGISTRY` string binding and the sender bot token as `SLACK_BOT_TOKEN` through the private deployment environment. Keep private configuration outside the repository and avoid echoing it in deployment logs. Verify the active release retains these bindings on subsequent deploys.
3. Enable `DELIVERY_ENABLED=true` and `WORKFLOW_LOGS_ENABLED=true`. The sender polls the ledger every five minutes. Observe a naturally completed canary workflow and match its GitHub run, attempt, conclusion and logs link with the Slack message. Verify its acknowledged receipt via the internal publisher's `receipt` method. A manual Slack message, channel invitation or queued intent provides no end-to-end evidence. Check a second attempt and cancellation as they occur. Record the GitHub run links, receipt counts and observed delay on #6370. Retain Slack IDs and timestamps in the private operations record.
4. Generate the full registry using `--base` and `--enable all`, deploy it privately, and check acknowledged runs per channel as each workflow fires. For a backlog check `summary().workflowLogs` and the sender's retry, dead and ambiguous counts. Correct missing memberships or catalog mappings, then allow the relay to resume. To stop workflow intake, disable `WORKFLOW_LOGS_ENABLED`. To pause queued workflow sends while keeping other roles available, deploy a registry with those workflow entries' `enabled` flags set to `false`. Global `DELIVERY_ENABLED=false` pauses all sends.

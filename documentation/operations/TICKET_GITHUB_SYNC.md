# Recover support tickets missing from GitHub

The Studio Eadwyn **File ticket** form calls `POST /api/tickets`. The Worker
saves the ticket in D1, then creates an issue in the repository named by
`GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME`. Production targets
`AxalNetwork/StudioOS`. A GitHub failure preserves the local ticket and records
`github_sync_status` and `github_sync_error`.

## Confirmed production blocker, 2026-10-02

The operator ran **Admin Console → GitHub Sync → Test issue creation** and
reported: “The token reached the repo but may not create issues — it needs
Issues: Read and write.” This is the write probe's GitHub HTTP 403 response.
Production binding inspection also confirmed the token is present and the
owner and repository are correct. The token's value was not read.

A configured token or a successful read test does not establish write access.
The development environment's GitHub credentials used to push PRs are separate
from the Worker's `GITHUB_ACCESS_TOKEN`. Changing this code does not grant the
production token permission.

## Restore issue creation

1. In GitHub, open **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** and edit the token used by StudioOS (or create a
   replacement).
2. Set resource owner **AxalNetwork**, include repository **StudioOS**, and set
   **Repository permissions → Issues → Read and write**. Complete any required
   organization approval. Preserve permissions used by other Worker features,
   including Actions write if this token dispatches branch deployments.
3. If replacing the token, a StudioOS Super Admin must save it in
   **Admin Console → GitHub Sync** after a fresh TOTP step-up. Never put a token
   in chat, source control, or a ticket. Updating the existing token's
   permissions does not require saving its unchanged value again.
4. Run **Test issue creation**. It must create a real test issue and close it.
5. File one support ticket from `/studio` and follow its **View on GitHub** link.

## Recover tickets already saved

After deploying the recovery control, open `/help/tickets` as an admin and
click **Create missing GitHub issues**. Each click attempts up to 25 unlinked
tickets and reports failures and the remaining count. Repeat as necessary.
Opening the page or its periodic refresh never creates missing issues.

The existing `POST /api/tickets/sync` endpoint accepts `{ "backfill": true }`
from an authenticated admin. Non-admins cannot backfill. Concurrent attempts
claim each row before creating an issue; interrupted claims expire after five
minutes. This protects overlapping requests, but is not distributed exactly-once
delivery: if GitHub creates an issue and its response or the D1 link write is
lost, inspect GitHub for the ticket's `axal-sync:ticket-<id>` body marker before
retrying. No production backfill was run as part of this change.

The webhook secret controls updates from GitHub back to StudioOS; changing it
does not repair outbound issue-creation permission.

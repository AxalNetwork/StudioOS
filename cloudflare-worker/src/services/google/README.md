# Google Workspace readers

`workspace.ts` (D1091, #2956) holds the member's `drive.file` grant check,
GET-only frozen `GOOGLE_WORKSPACE_READS`, bounded file readers, the connection's
credential-free integrations row and disconnect cleanup. The single Google
refresh token stays in Calendar's store. Provider bodies never become errors.

Every new read must have a fixed origin/path in the allowlist, a timeout,
a response limit and a fake. Never add a provider write here. Five-row previews
are ephemeral. No module importer is built in part 2.

`growFeeds.ts` (D1095, #2960) is Grow's From Google. It lands a mapped metrics
Sheet in `project_metrics` with `source = 'google_sheets'`, only in the columns
no Stripe or Mercury writer owns. It turns `#board` and `#filing` events from
the member's primary Calendar into proposals that Accept writes as obligations.
Every landed row goes through D655's ledger, so Stop using and a founder's
deletion both hold on the next sync.

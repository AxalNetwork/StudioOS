# Google Workspace readers

`workspace.ts` (D1091, #2956) holds the member's `drive.file` grant check,
GET-only frozen `GOOGLE_WORKSPACE_READS`, bounded file readers, the connection's
credential-free integrations row and disconnect cleanup. The single Google
refresh token stays in Calendar's store. Provider bodies never become errors.

Every new read must have a fixed origin/path in the allowlist, a timeout,
a response limit and a fake. Never add a provider write here. Five-row previews
are ephemeral. No module importer is built in part 2.

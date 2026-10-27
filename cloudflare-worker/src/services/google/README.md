# Google Workspace readers

`workspace.ts` (D1091, #2956) holds the member's `drive.file` grant check,
GET-only frozen `GOOGLE_WORKSPACE_READS`, bounded file readers, the connection's
credential-free integrations row and disconnect cleanup. The single Google
refresh token stays in Calendar's store. Provider bodies never become errors.

Every new read must have a fixed origin/path in the allowlist, a timeout,
a response limit and a fake. Never add a provider write here. Five-row previews
are ephemeral. No module importer is built in part 2.

`buildFeeds.ts` (D1093, #2958) is the first module feed: spec Docs chosen for
Solution design become proposals (title and headings only) that land as a
design note on Accept, and a roadmap Sheet chosen for Product roadmap lands
rows into `roadmap_okrs` once its columns are mapped, through the ledger and
under `fedOwnership.ts`'s one-owner rule. It reads through `workspace.ts` only.

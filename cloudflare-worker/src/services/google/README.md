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
`buildFeeds.ts` (D1093, #2958) is the first module feed: spec Docs chosen for
Solution design become proposals (title and headings only) that land as a
design note on Accept, and a roadmap Sheet chosen for Product roadmap lands
rows into `roadmap_okrs` once its columns are mapped, through the ledger and
under `fedOwnership.ts`'s one-owner rule. It reads through `workspace.ts` only.
`validateFeeds.ts` (D1092, #2957) is the first module importer: Validate's
three feeds over part 2's stores. A Doc mapped to an interview becomes that
interview's session text through `interviewIntake` (provider `google_docs`);
a mapped Form's qualifying responses become `demand_signals` at `to_confirm`
(source `google_forms`), reading each response's id, date and one mapped
answer and never who sent it; signals the founder confirmed are offered as
Experiments evidence in `google_workspace_proposals`. Every landed item has a
`connector_fed_items` row, so a re-sync lands it once and a deleted one stays
deleted. Raise (part 5, #2959) adds its importer beside these.

# Google Workspace readers

`workspace.ts` (D1091, #2956) holds the member's `drive.file` grant check,
GET-only frozen `GOOGLE_WORKSPACE_READS`, bounded file readers, the connection's
credential-free integrations row and disconnect cleanup. The single Google
refresh token stays in Calendar's store. Provider bodies never become errors.

Every new read must have a fixed origin/path in the allowlist, a timeout,
a response limit and a fake. Never add a provider write here. Five-row previews
are ephemeral. No module importer is built in part 2.

`raise.ts` (D1094, #2959) is part 5, Raise: a chosen Slides deck becomes a
deck-version proposal, chosen Drive files are copied into the data room (a
Google file exported to PDF, replaced only when Google's `modifiedTime`
changed), and Calendar events whose attendee domain is a prospect's firm
domain propose "last met <day>". Its one Calendar read is `GOOGLE_CALENDAR_READS`
(GET, fields limited to the start and attendees); only the day is stored,
never an address. Each later part adds its own file here and its entries to
`GOOGLE_WORKSPACE_FEEDS`.

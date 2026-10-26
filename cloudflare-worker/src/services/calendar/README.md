# Calendar services

The unified calendar's logic below the routes (`../../routes/calendar.ts` and its siblings). Nothing here answers HTTP.

| File | What it is |
|---|---|
| `sync.ts` | Two-way sync of Axal-booked sessions with a member's Google or Outlook calendar; `removeProviderCopies` is a disconnect's "Remove the copies first" |
| `syncState.ts` | D1209 (migration 610): the error code a failed sync leaves on the token row, and whose copies a disconnect kept |
| `cancelEvents.ts` | D1131: removing tracked copies when an event is cancelled, through the job queue with retries |
| `myEvents.ts` | D1033: event tickets and hosted events as calendar kinds, and the add-to links |
| `feedTokens.ts` | D1033 (migration 603), D1209: the private feed token, stored as its SHA-256 only |
| `items.ts` | D1207: what each item carries for the person reading it; only the page read calls it |
| `investorMeetings.ts` | D1190: the `investor_meeting` kind, from a prospect's timeline in Capital relationships |
| `sourceReaders.ts` | D1208: four personal, read-only sources; no provider calls |

**Adding a file:** one concern per file, named for what it reads or writes, with its decision in the header comment, and a row here. A new calendar source goes in `sourceReaders.ts` unless it calls a provider.

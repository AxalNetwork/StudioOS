### Calendar part 6: the item drawer, the dialogs and Meet on create (D1211, #3177)

`routes/calendar.ts`; `services/calendar/itemRead.ts`. No migration.
- `GET /api/calendar/item/:kind/:id` (`requireAuth`): `{ item }`, the one item the page read would give its reader (the same owner-only reader, cancelled rows included, described by `describeItems`). Its attendees leave as `people` (`name`, `profile`, `stands`, `answer`), never an email or a user number; the reader's own answer is `my_rsvp`.
  - A meeting the reader is not part of, and one that does not exist, both answer 404 `{ error: 'not_party', detail }` (CAL18). An unknown kind or id is 400 `invalid_item`. A source that does not answer is 503 `unreadable`.
  - An IC meeting or a check-in is looked for around its own start; any other kind within 400 days of today.
- `POST /api/calendar/ic-meetings` and `POST /api/calendar/founder-checkins` take `add_meet: true`. After every existing gate, the Meet link is made on the creator's own Google account (`googleMeet.createMeeting`), before anything is saved, and becomes `location_uri`. That Google event is then recorded as the creator's copy in `calendar_sync_records`, so the copy hook PATCHes it rather than writing a second one.
  - Refused with nothing saved: 409 `meet_not_connected` or `meet_reconnect`, 502 `meet_create_failed` or `meet_link_unavailable`, 503 `meet_unreachable`, each with `MEETING_ERRORS`' sentence.
- `POST /api/calendar/founder-checkins`: a founder who names no founder is the founder (New check-in sends only `counterpart_uid`).
- Page: `/calendar/item/:kind/:id` (same guard as `/calendar`) opens `CalendarItemDrawer.jsx` over the view in `state.from`, else Month. The header's New menu, New IC meeting, New check-in, Reschedule and Cancel are `Lightbox` dialogs (bottom sheets on a phone); the row's Cancel no longer uses `window.confirm`.


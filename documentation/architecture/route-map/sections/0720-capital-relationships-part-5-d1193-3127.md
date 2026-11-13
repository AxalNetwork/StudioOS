### Capital relationships part 5 (D1193, #3127)

`cycle_raise.ts`, mounted at `/api/cycles/raise`; `services/capRelTabs.ts`, under the module's gate (the venture's founder or an accepted co-founder; staff are refused, D1191).
- `GET /capital-relationships/activity?project=&q=&kind=&investor=&page=` → `{ items: [{ at, who, who_role, what, investor, source, source_label }], total, page, page_size: 25, kinds, not_here }`: the `raise.capital-relationships` log rows, newest first, never an email. A bad `kind` or `investor` is 400.
- `GET /capital-relationships/materials?project=` → per investor not passed: the deck links made for them, the data room's opens by their Axal account (the room's owner alone, D1102), and a sent call. Nothing recorded is "Not sent"; no account is "Not on Axal".
- `GET /capital-relationships/proposals?project=` → the caller's own open `proposals` and `drafts` on this venture's investors.
- `POST /capital-relationships/proposals` `{ prospect_id, event_id? }` → one metered run (`rail_write`, page `/raise/capital-relationships`) over the named note, or the investor's newest; each kept proposal (a next step, or a move to Contacted, Meeting or Diligence) quotes the note. 404 another investor's note; 422 a note too short.
- `POST /capital-relationships/proposals/:uid/accept` `{ edited? }` → written through `setProspectNextStep` or `updateProspect` (the warm path kept), then decided; 404 once decided; 400 a move to Committed or Passed.
- `POST /capital-relationships/drafts` `{ prospect_id, purpose: follow_up|thank_you|intro, via? }` → 201 a draft for the founder to send; 422 `draft_dropped` when it names a figure. Edit and Dismiss are `POST /api/ai/rail/proposals/:uid/decide`.
- `contacts.ts`: `PUT /raise-round` takes `currency` (three capital letters) and logs `round_updated`; `POST`/`PUT /raise-closes` log `close_added` and `close_updated`. A stage move logs its two stages.


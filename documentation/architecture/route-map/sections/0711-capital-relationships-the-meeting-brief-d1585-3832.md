## Capital relationships — the meeting brief (D1585, #3832)

"Prep" on an investor meeting in the Calendar item drawer (`/calendar/item/investor_meeting/:id`). No board draws it; it follows the drawer's own sections. No model runs.

| Address | What | Backend |
| --- | --- | --- |
| `/calendar/item/investor_meeting/:id` | Prep: who and where they stand, last met, what they raised, what others raised, the deck links with views, read time and signals, the latest steps | `GET /api/cycles/raise/prospects/:id/brief?project=&event=` (`services/prospectBrief.ts`) |

# Capital relationships map — 2026-10-25

The owner's "Capital relationships" canvas (#2457, boards CRL1–CRL19), read against the code on `origin/main` that day. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1188.

## 1. The canvas

`design/incoming/Capital relationships · Boards.dc.html` holds the board grid, which imports `Capital Relationships Page.dc.html`.

| Boards | What they draw |
|---|---|
| CRL1 | Overview for a founder: the tab strip (Overview, Pipeline, Match, Outreach, Commitments, Calls, Activity), the round, follow-ups due |
| CRL2–CRL6 | Pipeline as a board and a list, the investor lightbox, Add investor and Import, and the step, next step, status and feedback dialogs |
| CRL7–CRL10 | Match, Outreach, Commitments, and the round settings with a new close |
| CRL11–CRL12 | Eadwyn's proposals; Activity |
| CRL13–CRL19 | Moved notices, empty, loading and errors, profiles, no permission, phone, dark |

## 2. #2457's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | An unmarked commitment counts as signed | **Fixed:** raised sums `commit_status IN ('signed','wired')`; a null status is null (`routes/contacts.ts`) |
| 2 | The pipeline edits the wrong venture | **Fixed:** `RaisePipelinePage.jsx` reads `?project_id` |
| 3 | Two writers, one unaudited | **Fixed:** the contacts `PUT` logs `prospect_updated` |
| 4 | Any admin reads every venture's investors | **Open** (part 3, #2459 decision 3) |
| 5 | Feedback's answer never shown | **Open** (part 1) |
| 6 | Fit copy overclaims | **Open** (part 1) |
| 7 | Match counts warm paths it never shows | **Open** (part 1; the page retires in part 6) |
| 8 | "Open in Contacts hub" opens the front page | **Open** (part 1) |
| 9 | Eadwyn's notes for `/raise/calls` and `/raise/call` | **Open** (part 1) |
| 10 | Committed against target adds soft money | #2447's |

## 3. What each tab can read today

| Tab | Read | Drawn by D1188 |
|---|---|---|
| Overview | the module read | As today, with the tab bar |
| Pipeline | the module read's Investors | A list, each opening its record |
| Commitments | `/api/contacts/raise-closes`, `/raise-pro-rata` | Today's closes and pro-rata panels |
| Calls | the module read's `parts.calls` | Today's calls history |
| Match, Outreach, Activity | none | Not read here yet |

## 4. What waits, and on what

- **Fixes** (part 1), **the Worker reads and migration 607** (part 2) and **access** (part 3) start now.
- **The tool** (parts 4 and 5) follows part 2.
- **The old pages' retirement** (part 6) waits until the tool is live.

# Calls for Capital map — 2026-10-26

The owner's "Calls for Capital" canvas (#2458, boards CLS1–CLS15), read against the code on `origin/main` at `fc5e32007d`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1221.

## 1. The canvas

`design/incoming/Calls for Capital · Boards.dc.html` holds the board grid, which imports `Calls for Capital Page.dc.html`.

| Boards | What they draw |
|---|---|
| CLS1 | Calls switched off: what a call is, why it is off, the seven readiness items, New call disabled |
| CLS2, CLS3 | The list with its counts; empty |
| CLS4–CLS7 | The new-call sheet: the round, materials and audience, preview, send and its result |
| CLS8, CLS9 | One call, open, and its other states |
| CLS10, CLS11 | Dialogs (extend, close, answer) and the recipient drawer |
| CLS12 | Loading and errors |
| CLS13 | What the investor sees ("Deals › Round calls › [company]") |
| CLS14 | Profiles and no permission |
| CLS15 | Phone |

## 2. What "Calls" was, and what each board can read today

- **Before D1221** Raise's "Calls" tab opened `/raise/capital-relationships#calls`: a section under the investor table. In production the section said one line, "Coming soon. Round calls are not enabled." The reason is that `ROUND_CALLS_ENABLED` is `"false"` until counsel answers #1008 item 19.
- **D1188** added `/raise/capital-relationships/calls` as a tab word, drawing that same section.

| Board | Read | Drawn by D1221 |
|---|---|---|
| CLS1 off | `parts.calls` is `{ enabled: false }` | What a call is, why it is off, the seven readiness items, New call disabled with its reason |
| CLS1 readiness, each item ready or not | none while off (`/round-calls/*` refuses all but availability) | Not read here yet |
| CLS2 list | `parts.calls`: state, sent, close, target, indicated, recipients, opened, data-room requests, responses, unanswered questions | Every count, amounts as Indicated |
| CLS2 delivery failures | `round_call_recipients.delivery_state`, not in the read | Not read here yet |
| CLS3 empty, CLS12 unreadable | `parts.calls` | Yes |
| CLS4–CLS7 sheet | `/raise/call` (`RoundCallSheet.jsx`) | As today |
| CLS8–CLS11 one call | `GET /api/round-calls/:uid` (`RaiseCallPage.jsx`) | At `/raise/capital-relationships/calls/:uid`, as today |
| CLS13 investor | `/round-calls/:uid` (`RoundCallPage.jsx`) | As today |
| Co-founders (CLS14) | `round_calls.ts` `owner()` admits the owner only | Not read here yet |

## 3. #2458's broken items, re-checked

| # | Finding | On `main` after D1221 |
|---|---|---|
| 1 | The tab leads nowhere real | **Fixed by D1221:** the tab opens the Calls for Capital page, which says what a call is and why it is off |
| 2 | Indicative amounts read "Committed" | **Fixed on the new page** (Indicated); the old section and the one-call page still say committed (part 6) |
| 3 | Eadwyn's page notes describe the wrong thing | **Open** (part 6) |

## 4. What waits, and on what

- The Worker part (1) starts now. It needs no migration.
- The frontend parts follow it. The investor's page (5) starts now, under owner question 5's recommended answer.
- The flag stays `"false"` until the owner records counsel's answer on #1008 item 19. Nothing here switches it on.

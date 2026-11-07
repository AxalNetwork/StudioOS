# frontend/src/pages/relationships — relationship intelligence

Who on the member's teams knows an investor, a founder or a company, the ask for an introduction, the introducer's inbox, the log and follow-ups (D1357, #3572, LinkedIn part 8). Built to the owner's canvas: `design/incoming/Who Knows Them Page.dc.html` and `design/incoming/Who knows them · Boards.dc.html` (RI1–RI8). Every read and write is `relationshipsApi` (`lib/api/relationships.js`, D1356 and D4329).

| File | What it is |
|---|---|
| `relationshipsModel.js` | Pure: the words, the strip's rows (at most three, never a count), the ask's rules, the log's rows, outcomes ("Not recorded" until one is), follow-ups, D4464's summary field ("Not recorded" on `recorded: false`, never 0). |
| `SharingCard.jsx` | RI1, RI7: "Let my team see who I know", one switch per team, what is and is never shared; turning it off asks first. On Account › Connectors › LinkedIn and Network › Relationships. |
| `WhoKnowsStrip.jsx` | RI2, RI3: "Who knows them" on a record, with Rank by fit, and the ask Sheet (reason required, context optional, "Ask Eadwyn to draft from this record"). On Capital relationships' investor sheet and Deal flow's peek drawer. |
| `IntroductionsDesk.jsx` | RI4–RI6: a summary card (D4464), Asked of you (Accept, Not now, Write the intro or Ask Eadwyn to draft it, through the Email composer), follow-ups (Mark done, Snooze, Ask Eadwyn to draft one), and the log with team and status filters. Reads `?intro=<uid>` (the Worker's introLink, D4329) and highlights that row. On Network › Introductions. |
| `DraftFlow.jsx` | D4330 (part 8b): the shared quote-then-run behind every "Ask Eadwyn to draft…" button (`useDraftFlow`) and the panel that shows the quote and its confirmation (`DraftFlow`). No fetch of its own — `run` is the one call its caller already owns. |

## The rules for adding here

- **No contact detail, ever.** A person is a name, a company and a title. No email, phone, notes or LinkedIn link reaches these files.
- **A teammate who did not share is absent.** No count, no gap, no locked or blurred row hints at them.
- **Axal never contacts the person.** An introduction is asked of the teammate; the intro email is sent from the teammate's own mailbox, and that send records it as made.
- **Eadwyn drafts only once asked (D4330).** Every "Ask Eadwyn to draft…" button quotes the run first (`estimate: true`, runs nothing) and the member confirms before it runs — never "Fill", always "Ask".

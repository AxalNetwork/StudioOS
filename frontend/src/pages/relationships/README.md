# frontend/src/pages/relationships — relationship intelligence

Who on the member's teams knows an investor, a founder or a company, the ask for an introduction, the introducer's inbox, the log and follow-ups (D1357, #3572, LinkedIn part 8). Built to the owner's canvas: `design/incoming/Who Knows Them Page.dc.html` and `design/incoming/Who knows them · Boards.dc.html` (RI1–RI8). Every read and write is `relationshipsApi` (`lib/api/relationships.js`, D1356 and D4329).

| File | What it is |
|---|---|
| `relationshipsModel.js` | Pure: the words, the strip's rows (at most three, never a count), the ask's rules, the log's rows, outcomes ("Not recorded" until one is), follow-ups. |
| `SharingCard.jsx` | RI1, RI7: "Let my team see who I know", one switch per team, what is and is never shared; turning it off asks first. On Account › Connectors › LinkedIn and Network › Relationships. |
| `WhoKnowsStrip.jsx` | RI2, RI3: "Who knows them" on a record, with Rank by fit, and the ask Sheet (reason required, context optional). On Capital relationships' investor sheet and Deal flow's peek drawer. |
| `IntroductionsDesk.jsx` | RI4–RI6: Asked of you (Accept, Not now, Write the intro through the Email composer), follow-ups, and the log with team and status filters. On Network › Introductions. |

## The rules for adding here

- **No contact detail, ever.** A person is a name, a company and a title. No email, phone, notes or LinkedIn link reaches these files.
- **A teammate who did not share is absent.** No count, no gap, no locked or blurred row hints at them.
- **Axal never contacts the person.** An introduction is asked of the teammate; the intro email is sent from the teammate's own mailbox, and that send records it as made.
- **Eadwyn's drafts wait for part 8b (#4330).** Their buttons are drawn disabled until its routes merge.

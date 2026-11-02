# frontend/src/pages/raise/caprel — the Capital relationships tool

The founder's Capital relationships tool at `/raise/capital-relationships` (D1188, #2457), built to the owner's canvas: `design/incoming/Capital Relationships Page.dc.html` and `design/incoming/Capital relationships · Boards.dc.html` (CRL1–CRL19).

| File | What it is |
|---|---|
| `CapRelTool.jsx` | The tool's tab bar (`CapRelTabBar`), Overview's tab bar (`CapRelHomeNav`), and its tab pages (`CapRelTabPage`). Calls draws the module read; every other tab draws its own file below. |
| `capRelModel.js` | Pure: the addresses, the canvas's seven tabs, `isCapRelTab`, and the venture-only query. D1192: the board's columns and moves, the status rule, Overview's figures and Needs you, the import's rows, chunks and merged answer, and the moved notices. |
| `CapRelPipeline.jsx` | D1192 (CRL2–CRL6): Pipeline's board and list, the investor sheet (the shared `Sheet`, D1317), Add investor and Import, and the move, status, next step, step and feedback dialogs. Every write goes through `cloudflare-worker/src/services/raiseWriters.ts`. |
| `CapRelOverview.jsx` | D1192 (CRL1, CRL13): Overview's blocks above the module page's own, and the moved notice. |
| `CapRelMatch.jsx` | D1193 (CRL7): Match, D1190's match read: each fund's Fit and why, warm paths from your own network, verified investors as a count only, and Add to pipeline with the fund filled in. |
| `CapRelOutreach.jsx` | D1193 (CRL8): follow-ups (Done, Snooze, Draft a message), Eadwyn's drafts for the founder to send from their own email, materials sent per investor, and updates through Grow's share sheet. |
| `CapRelCommitments.jsx` | D1193 (CRL9, CRL10): committed against the target with what is not counted, every commitment with its status and source, closes, Mercury's matched credits, pro-rata, and the Round settings and New close dialogs. |
| `CapRelActivity.jsx` | D1193 (CRL12): every logged change across investors, the round and its closes, with who, when and its source; Export saves the rows on screen. |
| `CapRelProposals.jsx` | D1193 (CRL11): Eadwyn's proposals from a note, each beside its words, accepted, edited or dismissed by a person. |
| `capRelTabsModel.js` | D1193: pure rules for Match, Outreach, Commitments, the proposals and Activity. |

## Where the tool lives

The tool is the Capital relationships module, not a page beside it.
- Overview is CycleRoute's module page, which already draws the round card, the Investors table, the Calls section and Mercury's parts.
- The tab words (`/pipeline`, `/match`, `/outreach`, `/commitments`, `/calls`, `/activity`) arrive on the module's record route, `/raise/:slug/:id`. CycleRoute draws `CapRelTabPage` for them instead of a record (`isCapRelTab`).
- `/calls` (D1221, #2458) draws Calls for Capital, `../calls/CallsTab.jsx`; one sent call is at `/calls/:uid`, the one route `App.jsx` adds under this tool.
- `/closing` (D1213, #2424) is the round's closing room, `CLOSING` in `capRelModel.js`: not one of the seven tabs, so the tab bar keeps Commitments lit, and Commitments holds its door. It draws `../../closing/ClosingRoom.jsx`'s `FounderClosing`.
- An investor's own page is still its number, and `/new` is still Add investor.
- No route is added.

## The rules for adding here

- **Every row comes from a mounted read.** A read that fails says so where its block would be. A value nobody recorded says "Not recorded", never 0.
- **A commitment with no status is not counted as committed** (#2457 owner question 4).
- **Every write goes through the one writer** (`cloudflare-worker/src/services/raiseWriters.ts`, `cyclesWrite.raise.*`, or the record's own actions), never `contacts.ts`' older PUT.
- **Eadwyn proposes next steps, stage moves and message drafts.** It never writes an amount, a status or a Fit.
- **An admin reads one private response per reason (D1464, #4021).** `CapRelSupport.jsx` draws the reason gate on every tab for `admin`, then that one response read only: name, firm and stage, never an email or a note. Each further page asks for a fresh reason. The founder's Activity carries the reads (`../SupportReadsCard.jsx`).

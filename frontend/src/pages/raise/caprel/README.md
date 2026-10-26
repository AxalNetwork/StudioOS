# frontend/src/pages/raise/caprel — the Capital relationships tool

The founder's Capital relationships tool at `/raise/capital-relationships` (D1188, #2457), built to the owner's canvas: `design/incoming/Capital Relationships Page.dc.html` and `design/incoming/Capital relationships · Boards.dc.html` (CRL1–CRL19).

| File | What it is |
|---|---|
| `CapRelTool.jsx` | The tool's tab bar (`CapRelTabBar`), Overview's tab bar (`CapRelHomeNav`), and its tab pages (`CapRelTabPage`). Pipeline and Calls draw the module read; Commitments draws today's closes and pro-rata (`../RoundClosesPanel.jsx`); Match, Outreach and Activity say what they wait for. |
| `capRelModel.js` | Pure: the addresses, the canvas's seven tabs, `isCapRelTab`, the venture-only query, and each tab's wait. |

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
- **Eadwyn proposes next steps, stage moves and message drafts.** It never writes an amount, a status or a Fit.

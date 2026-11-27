# pages/influencer/section — the member's Influencer section (D4289 P7, #4296)

IN0–IN6 of `design/incoming/Influencer Page.dc.html` (notes in
`design/incoming/Influencer · Boards.dc.html`): the sidebar row, the header and
six tabs at `/influencer`, `/influencer/links`, `/influencer/offers`,
`/influencer/earnings`, `/influencer/audience` and `/influencer/resources`. The
routes are `frontend/src/routes/influencer.jsx`; the row is `INFLUENCER_ROW` and
`withInfluencerRow` in `frontend/src/sidebarConfig.js`. The decision is
`documentation/architecture/decisions/D4296.md`.

| File | What it is |
| --- | --- |
| `influencerSectionModel.js` | The words and rules, pure: the tabs and `tabFor`, the role accent, the honest values (a Count, "Fewer than 5", Not recorded, Unreadable, HQ reads), money per currency (`money`, `moneyLines`, `moneyFigure`, never summed), and each tab's view: `overviewView`, `linksView`, `offerView` and `offerStatus`, `earningTiles`, `payoutGate` and `payoutBody`, `audienceView`, `RESOURCES`. Tested by `frontend/test/influencer_section_4296.test.mjs`. |
| `influencerSectionReads.js` | The page's one seam to the Worker: `frontend/src/lib/api/influencer.js`, and `api.payoutsMe` / `api.payoutRequest` for the payout. A test passes stubs as the page's `reads`. |
| `InfluencerSectionPage.jsx` | The page: the membership check (the route's `member`, then `GET /api/influencer/me`), the header, the tab, each block's read only on the tab that draws it, and the viewer's Eadwyn rail (`WorkerRail`, key `<Profile> · Influencer`). |
| `InfluencerParts.jsx` | The shared pieces: `Figure`, `MoneyLines`, `BlockUnreadable`, `Panel`, `CopyButton`, the handle chip, the tier badge, Share, the header and tab bar, and `TwoStep` (in place of a confirm dialog). |
| `OverviewTab.jsx` | IN1 and IN1s: the handle link, pending and payable per currency, the five figures, the funnel, the commission per week per currency, the next milestone, the top channels and Eadwyn's line (the reply's `line`, as it is). |
| `LinksTab.jsx` | IN2: the handle and the page line (`PUT /api/influencer/me/handle`), the channel links with their figures (add, archive), and the QR code (PNG). |
| `OffersTab.jsx` | IN3 and IN3b: the offers and their states, and "Ask HQ for an offer" in a `Sheet`. |
| `EarningsTab.jsx` | IN4: the commission tiles per currency, the commission by week, bonuses, the payout checklist, the tax form, the terms, Request payout and the payout history. |
| `AudienceTab.jsx` | IN5: totals by plan family, region and month joined (`frontend/src/ui/Charts.jsx`'s `HBars`), still paying by month, and the time from first visit to paid. |
| `ResourcesTab.jsx` | IN6: static — the disclosure rules, what may not be promoted, the brand kit (no files published yet), the questions, and the Investor Pro benefit. |

## Rules

- **Every request is a mounted Worker route** (`node scripts/check-api-drift.mjs`).
  Nothing here invents a read: Resources is static, and the board's per-invoice
  ledger is drawn as the commission per week and per currency.
- **A Count is a number or "Fewer than 5"; a missing figure is Not recorded; a
  failed read is Unreadable.** None of them is ever drawn as 0.
- **Money is per currency and never summed.**
- **No referred member is named.** No read returns one, and no view carries a
  field that could.
- **The viewer's role accent; no new colour.** Every colour class has its `dark:` pair.

### D1130 — cap-table recorded views (#3010, part)

D1130 (#3010): `/cap-tables/:projectId` and `/share/captable/venture/:token`
read recorded issuances at D1019's level; scenario links remain Modelled.

D1463 (#3713): on `/cap-tables/:projectId`, a studio admin's Open for support…
is the shared reason gate (`ui/ReasonGate.jsx`, per open, 10–500) in place of
the table, then the amber access banner with no timer; the dialog is gone.

D1027 (#2864): the investor's read-only Cap table panel (CT15, CT15o, CT15n,
`raise/captable/InvestorCapTablePanel.jsx`) sits on the deal page's Terms tab
(`/deals/:dealId/terms`) and the company page's Terms
(`/portfolio/companies/:uid/terms`), reading `GET /api/captable/access/:projectId`
at the investor's level; not shared, "Ask for access" sends
`POST /api/captable/access/:projectId/ask` (once a day, an investor related to the
venture; the founder answers on Access). The investor never opens `/raise/cap-table`.
`/raise/cap-table/option-pool` reads venture grants and holder-linked 83(b)
filings, with the existing Company creation dialogs as the filing/proof writer.
Legacy admin cap-table reads are refused; support uses the logged level read.


# Reporting (D1060, #2930)

Grow's Reporting desk, Duties and one report, from the owner's canvas "Reporting" (`design/incoming/Reporting · Boards.dc.html`, RPT1–RPT8, RPT14, RPT15, RPT17–RPT19). `../ReportingDesk.jsx` is the page `CycleRoute` draws at `/grow/reporting`, `/grow/reporting/duties`, `/grow/reporting/:id` and `/grow/reporting/:id/edit`; everything it draws below the header is here.

| File | What it is |
|---|---|
| `deskModel.js` | The desk's rules over part 2's `GET /api/reporting/desk` (D1058): the state words and colours (late is amber, never red), Due next, Needs you, the twelve-month calendar and its keys, the selected period, Duties' rows, groups and filters, the drawer's terms and record, the reminder and expected-date words, and who reads only |
| `builderModel.js` | The builder's and the sent report's rules over part 3's routes (D1059): values (never 0 for a missing one), source chips, figures by module, readiness, the Accept rule for Eadwyn's lines (#2431), recipients, Send's lines and refusals, the revision strip and the report's address |
| `DeskBlocks.jsx` | Due next, Needs you, the calendar (one tab stop, arrow keys, View as table), Duties and its drawer (the shared `Sheet`, D1317). They read nothing themselves |
| `ReportingDialogs.jsx` | The in-page dialogs: Give an expected date, Reminder settings, Send and Correct, each keeping its refusal |
| `ReportPage.jsx` | One report: the four-step builder for a draft (founders only), and the sent report with Correct, read only for anyone else the Worker admits |

**Adding to it:** a number comes from a Worker read, never from the page; a figure with no value is a dash with the Worker's reason. The page sends choices (in or out, a reason, a share), never a figure's value, except the founders' own typed figures. Who may write is the Worker's `can_write` (the desk) or `view: 'team'` (a report), never the role alone. A change opens a dialog in the page; never a browser pop-up.

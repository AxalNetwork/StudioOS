# Reporting to investors — the canvas against the code, 2026-10-25

S21's map for D1056 (#2427). It reads the owner's "Reporting" canvas against
`origin/main` at `adf2921841`. The canvas has boards RPT1–RPT21 with lettered
boards, in `design/incoming/Reporting Page.dc.html` and
`Reporting · Boards.dc.html`. It is true as of that date: re-check the code
before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2427 called broken, re-checked

| # | #2427's finding | Today | Where |
|---|---|---|---|
| 1 | Operating Partners read every company's updates | **Fixed** (D889, #2438): a partner reads only ventures they are an accepted member of | `wk/routes/portfolio_updates.ts` `readerProjectIds` |
| 2 | The investor inbox ignores the chosen audience | **Fixed** (D889): an update shows only when its audience is switched on, or the reader is a recorded recipient | `portfolio_updates.ts` `INVESTOR_GRANT`, `TEAM_GRANT` |
| 3 | Grow updates always read "Not reported" (`YYYY-MM` against `YYYY-Qn`) | **Open** | `wk/routes/positions.ts` ~321; `wk/services/portfolioMetrics.ts` |
| 4 | Grow updates show "No KPI values recorded" (`kpis_json` against `metrics_json`) | **Open** | `portfolio_updates.ts` ~115 (`dto`) |
| 5 | Sent figures are not checked | **Fixed**: `cleanMetrics` keeps a figure's source only when it matches a verified figure, else "typed" | `wk/services/updateShare.ts` ~105 |
| 6 | The chase sends the founder to `/build/kpi` | **Open** | `wk/routes/portfolio.ts` ~418 |
| 7 | A second updates store, `raise_investor_updates` | **Open** | `wk/routes/contacts.ts` ~185, ~1200 |
| 8 | Portfolio shows positions you never signed | **Open**: positions are scoped by `investorProjectIds` (dealroom, introduction, watchlist) | `positions.ts` ~78 |

## 2. The reads on `main`

| Read | Shape | Boards |
|---|---|---|
| `GET /api/cycles/grow/modules/durable-company-building`, `parts.updates` | Every update sent, with its period, sent date, counts by audience, opens, replies and an `href` for the author | RPT1 History |
| `GET /api/portfolio-updates?project_id=` | The investor's readable updates of one company (D889's rule): `uid`, `period`, `title`, `submitted_at`, `kpis` | RPT10 Reports, RPT9 rows |
| `GET /api/positions` | Per held company: `project` (`uid`, `name`, `stage`), `total_invested`, `latest_round`, `first_date` | RPT10 header, RPT9 |
| `GET /api/positions/kpi-compliance` | Reported this quarter, per company (finding 3) | RPT9 state |
| `POST /api/portfolio/chase`, `GET /api/portfolio/chases` | D464's ask and its log | RPT11 Ask |
| `POST /api/portfolio-updates/share/draft-lines`, `/:uid/send`, `GET /:uid/page` | Share an update's Eadwyn lines, send and sent page | RPT4–RPT6 (the update path, not a report yet) |

Not read anywhere yet:
- a duty, its source clause and its terms (`reporting_duties`, #2424 and part 2);
- a period, its due date, late, missing, waived and expected states (`reporting_periods`);
- a report's frozen figures and their SHA-256, revisions and corrections;
- the assembler across the seven Grow modules, and team-only Mercury figures ticked to share;
- report documents;
- the holding's route (direct, via an SPV, via a fund), which needs #2424's `closing_lines`;
- reminders and reminder settings.

`closings`, `closing_lines` and `reporting_duties` do not exist on `main` (CAPITAL, #2424, is not built).

## 3. Board by board

| Board | Drawn by D1056 | Waits for |
|---|---|---|
| RPT1 Desk | Grow's tab row with Reporting lit (in place of Updates); title, line, Share an update; the History; Due next, Needs you and the calendar as "Not read here yet" with what each waits for | parts 2, 3, 4 |
| RPT2 Duties | `/grow/reporting/duties`, the canvas's line, "Not read here yet" | parts 2, 4 |
| RPT3–RPT5 Builder | — (Share an update stays the way to send) | parts 3, 4 |
| RPT6 Sent report | Today's `/updates/:uid` | parts 3, 4 |
| RPT7, RPT8 Late, reminders, duty drawer | — | parts 2, 4 |
| RPT9 Portfolio › Reports | The tab and zone are named Reports at `/portfolio/updates`; each company links its page | parts 1, 5 |
| RPT10 Company page | `/portfolio/companies/:uid` with Figures, Reports and Terms; the header from the investor's position; Reports from the company's readable updates; Figures and Terms "Not read here yet" | parts 2, 3, 5 |
| RPT11 Reader | Today's `/updates/:uid` from a Reports row | part 5 |
| RPT12 dark, RPT20, RPT21 phone | The pages carry dark pairs; the desk draws `CycleBar` below 1024px | part 6 |
| RPT13 Holdings (SPV, GP, LP) | — | #2424, part 5 |
| RPT14, RPT15 Advisor, Partner, Admin | Today's guard: admin and founder on Grow; admin and investor on Portfolio | parts 4, 5 |
| RPT16 Explorer | Refused by the guards | — |
| RPT17–RPT19 Empty, loading, error | Each read answers alone; a failed read says it is not a claim of none | parts 4, 5 |

# Accounts map — 2026-10-26

This audit reads the owner's "Accounts" canvas (#2377, boards ACC1–ACC14) against the code on `origin/main` at `59f54262c5`. It is a snapshot, true as of that date and **not maintained**. D1299 is the decision that acts on it.

## 1. The canvas

`design/incoming/Accounts · Boards.dc.html` holds the board grid. It imports `Accounts Page.dc.html` by name, one variant per board.

| Boards | What they draw |
|---|---|
| ACC1, ACC8 | Overview, light and dark: KPIs, a widget per profile, sign-ups, readiness, "Waiting on you" |
| ACC2, ACC3 | All accounts: the table, its bulk bar, filters, sort, saved views and columns |
| ACC4–ACC6 | The account drawer: Profile, Sub-accounts, Identity, Activity, Notes |
| ACC7 | The action dialogs |
| ACC9–ACC11 | Empty, loading, error and partial |
| ACC12 | The Super Admin's All accounts under HQ › Team |
| ACC13 | No permission |
| ACC14 | Phone |

## 2. What each board can read today

| Board · block | Read | Status on `main` |
|---|---|---|
| ACC1 totals and per-profile counts | `GET /api/admin/studio/glance` → `accounts.total`, `by_role`, `new_7d`, `new_30d`, `deactivated`, `exploring` (active accounts only) | built; drawn by D1299 |
| ACC1 active in 30 days, unverified, readiness, sign-ups by week | none | the overview read (D1301) |
| ACC1 LPs | `lp_applications` (approved), read for the LP applications page | no count on any account read |
| ACC1, ACC5 Product testers | `testing_applications` per programme; no standing tester status | no store (D1302) |
| ACC2, ACC3 list | `GET /api/admin/users`: newest first, 100 a page, `q` on name or email, totals over every row | built; filters, sort, columns and paging over the whole set are D1300 |
| ACC4–ACC6 record | `GET /api/admin/users/:id/profile` | built; it opens at `/admin/accounts/all/:id` since D1299 |
| ACC7 dialogs | role, access level, full access, support session, deactivate | built, partly through `window.prompt` and `window.confirm` (D1306) |
| ACC12 | `HqAccountsPage` at `/admin/hq-team` | built |

## 3. #2377's fifteen findings, re-checked

- **Fixed before this:** 14 (the slug). D941 made `/admin/accounts` the Admin's Accounts page and moved Team to `/admin/hq-team`.
- **Fixed by D1299:**
  - 1, in part: the overview draws totals and a widget per profile, and the two sub-accounts say why they have no figure;
  - the record has its own address, so #2369 and #2370's "Open member record" link resolves.
- **Fixed on `main`:** 3 (the Users table in the Admin Console). D938 retired the console; All accounts is its own page.
- **Open, each with its part:**
  - D1300: 4, 5, 6, 7, 8 (the list read);
  - D1301: 1, the rest (the overview read);
  - D1302: 2 (LP and tester sub-accounts);
  - D1303: 11, 13 (reason on full access, export, notes metadata);
  - D1304–D1307: 9, 10, 12 (the boards);
  - 15 (`/branch/accounts` built twice) follows #2297 §9.

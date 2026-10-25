# Fund admin map — 2026-10-25

This is the owner's "Fund Administration · Admin" canvas (#2388, boards FND1–FND22), read against the code on `origin/main` at `a265fb2561`.

This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1157.

## 1. The canvas

`design/incoming/Fund admin · Boards.dc.html` holds the board grid. It imports `Fund Admin Console Page.dc.html`.

| Boards | What they draw |
|---|---|
| FND1–FND2 | Overview, for the Super Admin and for the Admin: the header and the fund filter; the tiles, "Waiting on you" and the two charts; the funds table and the entity cards |
| FND3–FND4 | Funds, New fund, and one fund at `/funds/[id]` |
| FND5–FND6 | LPs across funds, and the LP drawer |
| FND7–FND9 | Capital calls, the call flow (preview, step-up, notices, receipt), Distributions |
| FND10–FND12 | NAV & performance, light and dark, and the mark dialogs |
| FND13–FND15 | Fees; Reports (packs, periods, notices); Banking (accounts and transactions, reconciliation, books) |
| FND16 | Arriving from Fund Ops: the moved notice, and HQ › Funds' new link |
| FND17–FND22 | Empty, loading, error and partial, no permission, phone |

## 2. #2388's missing items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | Fund Ops is a dead end; HQ › Funds sends there | **Open:** `/funds` renders `FundOpsWorkspace` for an admin (`App.jsx:3457`, `:3673`); HQ's foot link is `/funds` (`HqFundsPage.jsx:648`) |
| 2 | Fund Ops guesses 20%, 2% and $0 | **Open** (`FundsPage.jsx`); it retires with Fund Ops in part 3 |
| 3 | Fund Ops distributes with no preview | **Open** in Fund Ops; the console has the preview (D714) |
| 4 | The console sends you away for calls and the books | **Open** (`FundTabs.jsx`); parts 6 and 8 |
| 5 | No page edits a fund | **Open:** no caller of `PATCH /api/funds/:id`; part 4 |
| 6 | No LP view across funds | **Open:** no read; parts 1 and 5 |
| 7 | NAV cannot be recorded on screen | **Open:** `fundPerformanceApi.recordValuation` and `attribute` have no caller; part 7 |
| 8 | No performance history or chart | **Open:** as-of-today read only; parts 1 and 7 |
| 9 | No admin screen for notices and booklets | **Open:** the clients hold the LP's methods only; parts 5 and 6 |
| 10 | Not the shared header; `?tab=` tabs | **Tabs fixed by D1157** (sub-paths, `?tab=` forwards); the header is part 3 |
| 11 | Two links at old addresses | **Payment instructions fixed** on `main` (`/admin/platform/bank-accounts`); HQ › Funds' link is open (part 3); Open Banking and Reconciliation links moved by D1157 |

## 3. What each tab can read today

| Tab | Read | Drawn by D1157 |
|---|---|---|
| Overview | access, overview | As today |
| Funds | `GET /api/funds` exists, not drawn here | Not read here yet |
| LPs | per fund only | Not read here yet |
| Capital calls, Distributions, Fees, Reports | as D714 | As today, at their sub-paths |
| NAV & performance | `GET /api/fund-performance` (as of today) | `FundPerformanceView`, read on this tab only |
| Banking, Reconciliation | as D714, D749 | As today, at `/banking` and `/banking/reconciliation` |
| Books | `/api/fund-ledger` exists, not drawn here | Not read here yet |

## 4. Who can do what

`FUND_ACTS` (`services/fundAdminAccess.ts`) is unchanged.

Creating a fund (`requireFundCreator`) and recording a NAV mark (`requireFundGp`) have no act key yet. Part 2 adds `fund.create` and `fund.valuation`, at the Admin tier.

## 5. What waits, and on what

- **Worker reads** (part 1): LPs across funds, positions, and history.
- **Worker fields** (part 2): `lp_name`, the two act rows, and the booklets count.
- **Shell and Fund Ops retirement** (part 3) starts once D1157 is on `main`.
- **The tab bodies** (parts 4–8) follow parts 1–3.

# Use of funds map — 2026-10-25

The owner's "Use of funds" canvas (#2455, boards UF1–UF22), read against the code on `origin/main` at `6c665204ce`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1173.

## 1. The canvas

`design/incoming/Use of funds · Boards.dc.html` holds the board grid, which imports `Raise Use Of Funds Page.dc.html`.

| Boards | What they draw |
|---|---|
| UF1 | Home for a founder: the tab strip (Home, Allocation, Milestones and hires, Runway, Scenarios, Plan vs actual, History), the tiles, the round and runway sources |
| UF2–UF4 | Allocation, Edit split, a section's lightbox |
| UF5–UF6 | Milestones and hires, Add milestone and Add a hire |
| UF7–UF8 | Runway, and Runway › Forecast (the old financial model, "never runway today") |
| UF9–UF11 | Scenarios, and Scenarios compared (light, dark) |
| UF12–UF13 | Plan vs actual; where this plan is used |
| UF14–UF15 | Eadwyn's plan check; History |
| UF16–UF22 | Admin and Super Admin, empty, loading, error and partial, no access, phone, dark |

## 2. #2455's findings, re-checked

| # | Finding | On `main` today |
|---|---|---|
| new 1 | The financial model shows a built-in scaffold, saves blanks as defaults, drops Stripe's marks | **Fixed:** GET returns `exists: false` with nulls; PUT refuses a blank driver; `_sources` is kept (`routes/financials.ts`) |
| new 2 | The Lab page collapses five sections to three | **Fixed:** `BUCKETS` holds five (`SpinoutLabUseOfFundsPage.jsx`) |
| new 3 | Operating Partners read every model; recompute on view rights | **Fixed:** `isPrivileged` is admin only (#2460); recompute calls `ensureCanEdit` |
| new 4 | Deck templates invent a split | **Fixed:** the templates draw nothing with no split recorded |
| 3 | "Capital score" is read by nothing | **Open** (part 1, owner question 2 A) |
| 6 | Three readers read the split three ways | **Open:** readiness counts any `[` string (`services/raiseCycle.ts`) |
| 7 | "Actual against plan" says no store splits spend by category | **Open** (`services/records/raise.ts`) |
| 8 | The old tool drops the venture | **The module's tool link fixed by D1173**; the old tool's own tabs are part 1's |
| 9 | The cash line adds the whole raise in month 0 | **Open** |

## 3. What each tab can read today

| Tab | Read | Drawn by D1173 |
|---|---|---|
| Home | the module read | As today, with the tab bar |
| Allocation | the module read's sections | The sections, each opening its record |
| Milestones and hires, Scenarios, Plan vs actual, History | none of their own | Not read here yet |
| Runway | none in the tool | Not read here yet, with the financial model's link |

## 4. What waits, and on what

- **Fixes** (part 1) and **the engine and tables** (part 2, migration 606) start now.
- **The routes** (part 3) follow part 2. **The tool** (part 4) and **Scenarios and Forecast** (part 5) follow part 3. **Eadwyn** (part 6) follows part 3 and AUTOFILL.
- **The old capital model's deletion** (part 7) waits until the tool is live.

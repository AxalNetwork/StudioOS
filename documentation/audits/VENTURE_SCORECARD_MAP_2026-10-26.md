# Venture scorecard map — 2026-10-26

This audit reads the owner's "Venture scorecard" canvas (#2428, boards SC1–SC22) against the code on `origin/main` at `3f466ec0b7`. It is a snapshot, true as of that date and **not maintained**. D1253 is the decision that acts on it.

## 1. The canvas

`design/incoming/Venture scorecard · Boards.dc.html` holds the board grid. It imports `Venture Scorecard Page.dc.html`.

| Boards | What they draw |
|---|---|
| SC1, SC20 | The investor's Scorecard tab on the deal page, light and dark |
| SC2–SC5, SC22 | Scope drawers: Team, Traction, Geographic (two states), Risk for an Operating Partner, Product-market fit |
| SC6, SC7 | The deal list's scope strip and "Your weighting" |
| SC8, SC9, SC12, SC14 | The founder's Investor scorecard, Ask to correct, the trajectory, a new venture |
| SC10, SC21, SC13 | Add review; an Advisor read-only; HQ › Platform › Scoring |
| SC11 | How scoring works |
| SC15–SC18 | Loading, one scope unreadable, no permission, masked before the NDA |
| SC19a, SC19b | Phone |

## 2. What each board can read today

| Board | Read | Drawn by D1253 |
|---|---|---|
| SC1 panel, SC2–SC5, SC22 drawers | none: no venture scorecard, engine or `/api/venture-scores` | The eleven scopes in order, each Not read here yet |
| SC6 strip | none | An outlined strip read as "Scorecard: Not read here yet" in Deal flow's table |
| SC7 weighting | none | Not read here yet (parts 3, 5) |
| SC8 founder page, SC9, SC12, SC14 | none | `/raise/scorecard` with the panel and the founder's waits |
| SC10 reviews, SC21 sharing | none | Not drawn (part 5) |
| SC11 method | the model is #2428's text | `/scoring/method` draws it and says model v1 is not published |
| SC13 HQ | none | `/admin/platform/scoring` with three waits |
| SC17, SC18 | `canReadDeal`, `maskFounderForInvestor` | Unchanged; the panel sits inside the deal page's own gate |

The old signals stay as they are: the Lab's slider score, venture risk, readiness, DD band, trust and the rest of #2428's table of 24 (the issue cites each).

## 3. #2428's broken items, re-checked

| # | Finding | On `main` at `3f466ec0b7` |
|---|---|---|
| 1 | A client can send its own `ai_adjustment` | **Open** (part 1) |
| 2 | A score sets a venture's status with no person | **Open** (part 1) |
| 3 | Investors read every venture's risk | **Open** (part 1) |
| 4 | Unapproved scores reach investors through Screening | **Open** (part 1) |
| 5 | Missing data scores as zero (scorer, venture risk, deal gate) | **Open** (parts 1, 2) |
| 6 | Missing data scores as perfect | **Fixed for DD on main** (`computeScore` returns a null band until something is reviewed; D1244's map); the trust batch is **open** (part 1) |
| 7 | Any investor reads any person's trust score | **Open** (part 1) |
| 8 | Stubs as evidence | **Fixed on main** (#2391: a connector that is not live writes nothing) |
| 9 | Team is three typed sliders | **Open** (part 2) |
| 10 | Sources are mixed in the monthly series | **Open** (part 2) |

## 4. What waits, and on what

- Part 1 (fixes) and part 2 (engine) start now. Part 2 takes migration 625, part 3 takes 626, and part 6 takes 627 once the country index is chosen.
- The frontend parts follow part 3's read.
- The eleven owner questions take their recommended answers until the owner says otherwise (D1253 §5).

# Promo codes map — 2026-10-26

This audit reads the owner's "Promo codes" canvas (#2381, boards PRM1–PRM13) against the code on `origin/main` at `3f466ec0b7`. It is a snapshot, true as of that date and **not maintained**. D1270 is the decision that acts on it.

## 1. The canvas

`design/incoming/Promo codes · Boards.dc.html` holds the board grid. It imports `Promo Codes Page.dc.html`.

| Boards | What they draw |
|---|---|
| PRM1, PRM1m | Codes for a Super Admin, and the row menu by state |
| PRM2 (Overview, Redemptions, History) | One code, a lightbox over the list |
| PRM3, PRM4 | New code in five steps: applies to, discount, duration, limits and dates, review |
| PRM5, PRM6 | Edit and replace; pause, resume and end |
| PRM7, PRM8 | Usage, light and dark |
| PRM9–PRM12 | Empty, filters that match nothing, loading and error states, no permission |
| PRM13 | Phone |

## 2. What each board can read today

| Board | Read | Drawn by D1270 |
|---|---|---|
| PRM1 list | `GET /api/admin/promos`, every row, no paging | Today's list under the canvas's header, the HQ only pill and the Codes and Usage tabs |
| PRM1 states | `active`, `expires_at`, `times_redeemed`, `max_redemptions` | `promoModel.stateOf` in `promoState`'s order; paused and ended once recorded |
| PRM2 drawer | the row; no history read | The drawer at `/admin/platform/promo-codes/:id`, its history and scope waiting |
| PRM3, PRM4 plan scope | the catalogue, by product only | Not read here yet (part 3) |
| PRM5, PRM6 | `PATCH` takes `active` only; `DELETE` leaves `active = 0` | Unchanged (parts 2, 5) |
| PRM7, PRM8 usage | none | Not read here yet (part 4) |
| PRM12 | `hqOnly` on the screen; the Worker is `requireAdmin` | Unchanged screen; the Worker gate is part 1 |

## 3. #2381's missing items, re-checked

| # | Finding | On `main` at `3f466ec0b7` |
|---|---|---|
| 1 | In the Admin Console, no slug | **Fixed on main** by D938: `/admin/platform/promo-codes`, `hqOnly`, in Platform's strip |
| 2 | Two states only | **Open** (part 5); D1270's model already reads four, plus paused and ended once stored |
| 3 | Delete and Deactivate look the same | **Open** (part 2) |
| 4 | No edit; the UI does not say terms are fixed | **Open** (parts 2, 5) |
| 5 | Redemptions undercount | **Open** (part 4); the page now says the figure is a lower bound |
| 6 | No usage view | **Open** (part 4) |
| 7 | Scope is a raw product list | **Open** (part 3) |
| 8 | Cents and free-text currency | **Open** (part 5) |
| 9 | Repeating months not stored | **Open** (part 2) |
| 10 | No per-member or first-purchase limit | **Open** (part 3) |
| 11 | No name, note or campaign | **Open** (part 2) |
| 12 | No search, filter, sort or paging | **Open** (parts 2, 5); the filters are already in the address |
| 13 | Browser pop-up for delete | **Open** (part 5) |
| 14 | The Worker gate is wider than the screen | **Open** (part 1): `admin_promos.ts` still calls `requireAdmin` |
| 15 | Explorer completion codes live elsewhere | **Open**, not this page's |

## 4. What waits, and on what

- Part 1 (the gate) starts now and ships with #2386's gate task.
- Parts 2–4 start now and take migrations 629–631.
- The frontend parts follow their Worker parts.
- The three owner questions take their recommended answers until the owner says otherwise (D1270 §5).

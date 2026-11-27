# Storage map — 2026-10-25

The owner's "Account · Usage · Storage" canvas (#2449, boards STG1–STG20), read against the code on `origin/main` at `a265fb2561`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1166.

## 1. The canvas

`design/incoming/Storage · Boards.dc.html` holds the board grid, which imports `Account Storage Page.dc.html`. 1 GB = 1,024 MB on every board.

| Boards | What they draw |
|---|---|
| STG1 | A founder's storage at desktop: the allowance bar, by kind, by company with its ventures, the ten largest files, what counts |
| STG2–STG5 | Near the limit (80%, 95%), full, an upload refused where it happens, over the plan after a change |
| STG6–STG10 | Free, LP Access, Investor Pro, Advisor and Operating Partner, Admin and Super Admin |
| STG11–STG16 | Empty, loading, error, no permission, phone, dark |
| STG17 | The Usage hand-off: Overview's Storage card; Cost's details end at last run |
| STG18–STG19 | Pricing's Storage group and the LP band, desktop and phone |
| STG20 | HQ › Platform › Storage: totals only |

## 2. #2449's findings, re-checked

| # | Finding | On `main` today |
|---|---|---|
| — | No plan has a storage allowance; Pricing has no Storage row | **Open:** no `storage_bytes` anywhere in the Worker; `sitePricing.js` has no storage row |
| — | Storage sits under AI Cost | **Fixed by D1166:** its own page; Overview card; Cost's details no longer draw it |
| — | LP Access has no key; Investor Plus cannot be sold | **Open:** `planOf` knows `professional` and `institutional` only (`services/aiCredits.ts:576`); Checkout #2451 sells Plus |
| — | Nothing refuses an upload for space | **Open:** per-file 413s only |
| 1 | The meter misses Record a Session | **Open:** `storageUsage.ts` reads five areas |
| 2 | Data room versions not counted | **Open** |
| 3 | Six member stores have no size column | **Open** |
| 4 | Deck reviews not counted | **Open** |
| 5 | "GB" is 1,024³ | Settled by the canvas: 1 GB = 1,024 MB |
| 6 | Free and paid Advisors and Partners share a key | **Open:** part 1's `storagePlanKey` |
| 7 | The empty state's door is for founders only | **Open:** the canvas gives an investor "Open your research library" (part 5) |
| 8 | Investor Pro is $149 in code | Checkout's (#2451); Pricing draws neither price here |

## 3. What each block can read today

| Block | Read | Drawn by D1166 |
|---|---|---|
| By place | `GET /api/usage/storage` | As today's U6, titled By place |
| Your storage, the allowance and its states | none | Not read here yet |
| By kind, by company, largest files | none | Not read here yet |
| What counts | the meter's five places | Does not count drawn; Counts waits |
| Overview's Storage card | `GET /api/usage/storage` | Total, allowance Not read here yet, Open storage |
| Pricing's Storage group, HQ's totals | none | Not drawn (part 6) |

## 4. What waits, and on what

- **The allowance catalogue and plan key** (part 1) and **size records** (part 2, migration 605) start now.
- **The grown read** (part 3) follows both. **The guard, notices and HQ read** (part 4) follow parts 1 and 3.
- **The page complete** (part 5) and **Pricing and HQ** (part 6) follow their reads.

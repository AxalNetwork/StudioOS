# Product testing map — 2026-10-25

The owner's "Product Testing" canvas (#2382, boards TST1–TST16), read against the code on `origin/main` at `08bbeaffc6`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1195.

## 1. The canvas

`design/incoming/Product testing · Boards.dc.html` holds the board grid, which imports `Product Testing Page.dc.html`.

| Boards | What they draw |
|---|---|
| TST1, TST11 | Overview, light and dark: four tiles, applications and picks per week, places filled per open program, who applies by profile, whether Mail can reach the picked testers, programs by status, Needs you |
| TST2 | Review: partners' programs waiting for HQ as full cards; approved and not open; sent back |
| TST3 | The dialogs A–I: Approve, Send back, Open (and Open while intake is paused), Close, Move to testing, Pick, Decline, Withdraw for the member, a refusal |
| TST4 | Programs: status chips, search, filters, sort, pager, the table and its ⋯ menus |
| TST5, TST6 | One program, Axal VC's own and a partner's: lifecycle stepper, four mini stats, details, the Applicants sub-tab (read-only on a partner's), Activity |
| TST7 | New program, a lightbox over Programs |
| TST8 | Applicants: every application across programs |
| TST9 | Tester pool |
| TST10 | Member intake, three variants (#2318) |
| TST12–TST16 | Empty, loading, error and partial, no permission, phone |

## 2. #2382's missing items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | Admin Console header and dropdown, no own address | **Fixed by D938:** `/admin/platform/product-testing` under `AdminPageHeader`, `hqOnly` |
| 2 | No overview | **Partly fixed by D1195:** tiles, places bars and status chips from the programme list; the weekly series, by profile and Mail reach have no read |
| 3 | HQ cannot read a partner's applicants | **Open:** `ownerWhere` scopes HQ to HQ's own (`cloudflare-worker/src/services/testing.ts`) |
| 4 | No list across programmes; `?status=` unused | **Open** (the Programs table) |
| 5 | No history read | **Open:** `testing_events` is written and never read |
| 6 | "Testing" is never set | **Open** |
| 7 | Open and close tell no one | **Open** |
| 8 | No logo | **Open:** `logo_key` is stored; nothing uploads or serves it |
| 9 | No Mail reach figure | **Open** |
| 10 | No tester pool | **Store fixed by D1042** (migration 576, `routes/admin_product_testers.ts`); **D1195 draws it** on the Tester pool tab and tile |
| 11 | Withdrawn applicants vanish; nobody can withdraw for a member | **Open** |
| 12 | Pick and decline act at once | **Open** |
| 13 | Programs open with no member surface | **Open:** waits on #2318 |
| 14 | No Approvals lane | **Fixed by D1040–D1043** (`/admin/approvals/product-testers`), though that board still says the store is not stored; it is |

## 3. What each tab can read today

| Tab | Read | Drawn by D1195 |
|---|---|---|
| Overview | `GET /api/admin/testing/programmes`; `GET /api/admin/product-testers?status=active` (totals) | Open programs, waiting with the oldest, places filled on open and testing programs, the tester pool; places bars; status chips; four blocks Not read here yet |
| Review | the programme list; approve, reject, open, close | D815's console in its review view: waiting, approved not open, sent back |
| Programs | the same | D815's console as it was |
| One program | the programme list; HQ's own applicants, pick, decline | Details; HQ's own applicants (D815's `ProgrammeApplicants`); a partner's applicants and Activity Not read here yet |
| Applicants | none | Not read here yet |
| Tester pool | `GET /api/admin/product-testers?status=` | Status chips with totals, the applications link to Approvals, the table without email; approved by and programs Not read here yet |

## 4. What waits, and on what

- **Worker reads and writes** (parts 1–5) start now. None needs a migration: `testing_events` has no action CHECK, and `testing` is already a programme status.
- **The frontend** (parts 6–9) follows them.
- **Member intake (TST10)** waits on the owner's answer to #2318. Nothing on this page draws an intake variant until then.

# KYC & KYB map — 2026-10-26

This audit reads the owner's "KYC & KYB" canvas (#2384, boards KYC1–KYC17) against the code on `origin/main` at `f9ea115638`. It is a snapshot, true as of that date and **not maintained**. D1228 is the decision that acts on it.

## 1. The canvas

`design/incoming/KYC & KYB · Boards.dc.html` holds the board grid. It imports `KYC KYB Page.dc.html`.

| Boards | What they draw |
|---|---|
| KYC1, KYC2, KYC16 | People: the queue (oldest first), its filters and sort, and the dark check |
| KYC3, KYC3b | One person's case: the earlier rejection, masked values with Show, documents, seven automatic checks, sanctions and exposure, history, Eadwyn's summary |
| KYC4, KYC4b | The document viewer inside the page, and its refusals |
| KYC5 | A person's decision dialogs, A to G |
| KYC6, KYC7, KYC7b, KYC8 | Businesses: every kind in one queue, the business case, its decisions |
| KYC9 | Renewals: expired first, then the soonest |
| KYC10 | Audit: every look and decision |
| KYC11–KYC14 | Empty, loading, error and partial, no permission |
| KYC15 | Phone |
| KYC17 | Super Admin: licensed studios, Sent to HQ, renewal periods, audit export |

**The header** is "Approvals › KYC & KYB". The title is "KYC & KYB", with the line "Check who people and businesses are before they sign, invest or get paid. Every look and every decision is recorded."

**The tabs** are People, Businesses, Renewals and Audit. Underlined, they are `AdminPageHeader`'s `HeaderTab`.

## 2. What each board can read today

| Board | Read | Drawn by D1228 |
|---|---|---|
| KYC1 list | `GET /api/kyc/admin/queue?status=` (`kyc.ts:227`): one status at a time, newest first, unpaged | D648's queue, in the canvas's status words; each name opens the case |
| KYC1 figures, wait, ID type, country, flags, assignee, paging, sort, search | none | Not read here yet |
| KYC2 Needs information, Expired | none: the store holds `not_started`, `pending`, `approved`, `rejected` | Not read here yet |
| KYC3 identity | `GET /api/kyc/admin/:userId` (`kyc.ts:245`), masked, logged `kyc_record_access`; `/sensitive/:field` logged `kyc_field_shown` | The facts, the earlier rejection, masked values with Show |
| KYC3 documents, checks, sanctions, history, assignment, notes | one document (`/document`, behind Access); the provider result as raw JSON; `sanctions_screenings` by `user_id` (`trust.ts:563`); nothing for history or assignment | Not read here yet; the one document still opens from People's Review |
| KYC4 viewer | `GET …/:userId/document` opens in a new tab today | Unchanged (part 5) |
| KYC5 decisions | `PATCH …/approve`, `…/reject`: TOTP step-up, branch not suspended | Unchanged, on People's Review. The case says where to decide |
| KYC6–KYC8 businesses | none: `company_kyb_records`, `corporate_profiles` and `kyc_partner_imports` have no admin read | Not read here yet |
| KYC9 renewals | none: `kyc_v1` and `kyb_v1` expiry live in `legal_obligations` with no admin read | Not read here yet |
| KYC10 audit | none for studio admins: HQ's feed (`admin_security.ts`) is Super Admin only and leaves out `kyc_field_shown` | Not read here yet |
| KYC17 Super Admin | none | Not drawn (parts 2–4, 7) |

## 3. #2384's missing items, re-checked

| # | Finding | On `main` after D1228 |
|---|---|---|
| 1 | Console header and dropdown, no slug | **Fixed earlier** by D938: `/admin/kyc` under `AdminPageHeader`. D1228 adds the four tab addresses and the case address |
| 2 | No KYB in the admin | **Open** (parts 3 and 6) |
| 3 | A queue that is not a queue | **Open** (parts 1 and 5); the tab says what it lacks |
| 4 | A modal with raw data | **Partly**: the case page draws the identity facts, not JSON. The modal stays until part 5 |
| 5 | Browser pop-ups | **Open** (part 5): `KycConsole.jsx` still calls `alert` |
| 6 | Thin decisions | **Open** (parts 1 and 5) |
| 7 | The member is not told | **Open** (part 1) |
| 8 | Expiry half-built | **Open** (parts 1 and 4) |
| 9 | Sanctions separate and manual | **Open** (part 2) |
| 10 | No audit view | **Open** (part 4); the Audit tab says so |
| 11 | Three names | **Partly**: the status words are the canvas's. HQ › Team's copy is part 7's |

## 4. What waits, and on what

- The four Worker parts (1–4) start now. Parts 1–4 each need a migration, numbered 614–617.
- The frontend parts follow their Worker part.
- Owner questions 1–5 take their recommended answers until the owner says otherwise (D1228 §5).

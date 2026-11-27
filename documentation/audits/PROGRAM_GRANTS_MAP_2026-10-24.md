# Program grants — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`cc35435fd5` by S21 for #2376, before D981 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`, `sql/` is
`cloudflare-worker/sql/migrations/`.

The canvas is `design/incoming/Program Grants Page.dc.html`, boards GR1–GR15
(`board` options GR1 … GR15d, with GR5d, GR9a–b, GR10a–d, GR12a–b and
GR15a–d). #2376's body maps the page as it was on `537f646a3f`; this map
re-checks what D981 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| GR1 header, strip | crumb, one h1, the "HQ only" pill, the Licences strip | the ledger's own title "Territory licences" (`fe/pages/admin/AdminLicences.jsx`); no Licences entry in `HQ_STRIPS` (`fe/lib/hqStrips.js`) | D936's header; the strip added first (D981) |
| GR1 studios tile, grid rows | every licensed studio with reference, brand, kind, status, territories | `GET /api/admin/licences` (`wk/routes/admin_licences.ts`, `requireSuperAdmin`); `api.licences` | drawn (D981) |
| GR1 grid cells, three tiles, two charts | a grant per licence and program, requests, end dates | no grant store, no program list, no request kind: nothing in `wk/` or `sql/` names a program grant | "Not recorded" and "Not read here yet"; parts 1, 2, 6 |
| GR3 one studio | grants with terms, deal types, the request, recent changes | the licence read (`GET /api/admin/licences/:uid`) and its contract; no grant | part 6 |
| GR4, GR10 grant and its dialogs | terms from defaults, a reason, the authenticator | `requireSuperAdminWriteBar` (`wk/auth.ts`), as terms saves use it; the shared `StepUpModal` | parts 1, 6 |
| GR5 requests | the program request kinds and HQ's answer | `REQUEST_KINDS` has five licence kinds and none for a program (`wk/services/escalationRequests.ts`); HQ answers through the support queue (`fe/pages/admin/LicenceRequestsPanel.jsx`) | parts 2, 6 |
| GR6 default terms | one card per program with a "can be granted" switch | none | parts 1, 6 |
| GR7 the studio's tab | the licence's programs, its terms, the deal types | the licence page's six tabs (`fe/lib/licencePage.js`, `fe/pages/subsidiary/LicenceFrame.jsx`); `GET /api/licence/mine` carries no program | the tab added with the fixed facts (D981); parts 3, 7 |
| GR7 deal types | the subset a licence allows | `ALL_PARTNER_DEAL_TYPES`, five types, one list for everyone (`wk/services/partnerDeals.ts`) | "Not recorded"; part 5 |
| GR8, GR9 terms and the request sheet | read-only terms; a request with the open-request cap | `GET`/`POST /api/licence/mine/requests` (`wk/routes/licence_requests.ts`), capped at 20 open | parts 2, 7 |
| GR11 empty states | no licence, nothing granted, an account not linked to a licence, no requests | the licence page's none-state (`fe/pages/subsidiary/MyLicencePage.jsx`) | its HQ-held sentence added (D981); the rest with parts 6, 7 |
| GR12–GR15 states, refusals, dark, phone | each block's states; HQ-only refusal; dark; phone | `hqOnly`'s notice; `Unrecorded`, `Unreadable` (`fe/ui/Honesty.jsx`) | each part |

## B. What D981 rests on, re-checked at HEAD

- **No store.** No table, route or client names a program grant: a search of
  `wk/` and `sql/` for `program_grant` and `licence_programs` finds nothing.
- **The ledger read is Super Admin only** (`requireSuperAdmin`), so the page
  goes under `hqOnly` as `/admin/licences` does.
- **The licence page's tabs are addresses** (D800): a Programs tab joins them
  at `/admin/my-licence/programs` with no new mechanism.
- **Nothing is broken here.** The gaps are a missing feature, so D981 files no
  fix part.

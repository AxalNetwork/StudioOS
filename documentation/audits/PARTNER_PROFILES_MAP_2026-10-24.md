# Partner profiles — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`dfe7de6eaf` by S21 for #2380, before D989 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`.

The canvas is `design/incoming/Partner Profiles Page.dc.html`, boards PRF1–PRF12
(`board` options PRF1 … PRF12, with PRF3b–c, PRF4a–c, PRF5a–f, PRF7a–b,
PRF9a–c, PRF10a–c and PRF11a–c). #2380's body maps the page as it was on
`537f646a3f`; this map re-checks what D989 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| PRF1 header | crumb, one h1, line, scope, moved notice, two tabs with counts | the Admin Console's h1 and section dropdown (`fe/pages/AdminPage.jsx`); the tab's label "Partner Profiles" | D936's header; the tab forwards (D989) |
| PRF1 Waiting tile | count and the oldest one's age | Approvals' `partner_profiles` lane on the Studio glance (`wk/services/approvalSources.ts`), counting Eadwyn's name-only rows as pending | drawn from the lane (D989); Drafts with part 1 |
| PRF1 other tiles | 72-hour band, verified in 30 days, envelopes out | no per-profile age on the list; no `reviewed_at`; no envelope join | parts 1, 2, 4 |
| PRF1 queue | age, person, source, category, entity, account, identity check | `GET /api/profiling/admin/list` (`wk/routes/profiling.ts`): newest first by `created_at`, no date, no source, no account state | person, category, entity and agreement drawn, oldest first (D989); the rest part 1 |
| PRF2 charts | captured and decided per week; categories | no dates on the list, no decision date; `persona` and `founder_track` are | categories drawn (D989); weekly with parts 1 and 2 |
| PRF2 list | chips, search, filters, sort, pages, columns | the list, every row, no limit | chips, search and pages client-side (D989); the rest part 1 |
| PRF3, PRF4 | the record as a lightbox, every source's answers, history, the decision card | `GET /api/profiling/admin/:email` returns every column; the console's modal draws only the chat's fields | today's modal kept (D989); part 6 |
| PRF5, PRF6 | four dialogs, the tax ID's 60 seconds, Unbind, send results | `POST …/verify`; `GET …/sensitive/ein`; no reject reason, no reopen, no unbind route | parts 2, 3, 4, 6 |
| PRF7–PRF12 | states, no permission, phone, dark | the console's states; `ConsoleUnreadable`; a record failure is an `alert` | each block's own states and no `alert` (D989); parts 5–7 |

## B. What D989 rests on, re-checked at HEAD

- **The list is complete and ordered.** `ORDER BY p.created_at DESC` with no
  `LIMIT`, so its reverse is oldest first and its counts are whole.
- **Every read is `requireAdmin`:** Admin and Super Admin alike.
- **Three defects in the verify route** are filed as part 3: an unknown status
  saves as verified, an empty value cannot clear notes or the agreement, and the
  DocuSign plan check runs after the verdict is written.
- **The console's record read fails into `alert`**
  (`PartnerProfilesConsole.jsx`). The new page catches it in the page.

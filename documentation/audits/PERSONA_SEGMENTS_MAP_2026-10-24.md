# Persona segments — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`c661bdbb4e` by S21 for #2378, before D997 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`.

The canvas is `design/incoming/Persona Segments Page.dc.html`, boards SEG1–SEG14
(with SEG3i, SEG4a–c and SEG4t, SEG5d, SEG6c and SEG6s, SEG12d and SEG12f,
SEG13a–b, SEG14a–b). #2378's body maps the page as it was on `537f646a3f`; this
map re-checks what D997 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| SEG1 header | crumb per shell, one h1, line, scope, moved notice, tabs | the Admin Console's h1 and section dropdown; `?tab=personas` (`fe/pages/AdminPage.jsx`) | D936's header; the tab forwards (D997) |
| SEG1 tiles | in a segment, no segment, profile differs, moved in 30 days | `GET /api/personas/admin/list` (`wk/routes/personas.ts`): newest 500 accounts, admins included, primary persona, `source`, `confidence`, `role` | the first two drawn over members (D997); the other two parts 1, 5 |
| SEG1 by profile | a bar per segment under each profile, hollow no segment | the list's `role` per member; `role_alignment` is wrong (`wk/personas.ts`) | drawn by account role (D997); mapping part 1 |
| SEG1 how set, confidence | three sources; four bands | `source` and `confidence` (0–1) on the list | drawn (D997) |
| SEG1 weekly, needs and offers | tags per week; needs, offers, gaps | no tag date read; no needs or offers store | parts 2, 3 |
| SEG1 cards | per segment: who, members, top need, needs met, status | the taxonomy (`fe/lib/personas.js`): label, `short_description`, questions | who and members drawn (D997); the rest part 3 |
| SEG2, SEG3 | a segment's profile, answers, archetypes, members | `user_profile_extras` (never read for admins); archetypes per role (`wk/services/archetypeScoring.ts`) | parts 4, 5, 8 |
| SEG4 | the Move dialog | `POST /api/personas/admin/:user_id/retag`; today's `confirm()` and `alert()` (`PersonasConsole.jsx`) | today's table kept (D997); part 8 |
| SEG5 | members with no segment, why, ask to finish | the list's rows with no persona | list, chips, search drawn (D997); the rest part 5 |
| SEG6–SEG8 | edit, suggest, suggestions, scope, activity | none; `persona_retagged` activity rows only | parts 3, 5, 6, 9 |
| SEG9–SEG14 | dark, empty, loading, error, no permission, phone | each block's own states | parts 7, 10 |

## B. What D997 rests on, re-checked at HEAD

- **The list is capped at 500, newest accounts first,** with no total. A figure
  from it says so when it comes back at 500 (Guard L).
- **Admins are in the list.** The page leaves them out of every count.
- **`confidence` is stored 0–1** (`wk/routes/personas.ts` clamps it).
- **A plain Admin has no rail board here;** H22 is the Super Admin's.
- **The defects filed as part 1:** `role_alignment` sends ten segments to
  `partner`, so an Investor's segment links never show (`fe/App.jsx`'s sidebar
  rule); Advisors cannot reach `/onboarding/persona`; the guide says Investors
  and Advisors have one persona each.

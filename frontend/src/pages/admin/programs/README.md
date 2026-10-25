# Programs

D953 (#2371): Admin › Programs, built to the owner's "Programs" canvas
(PG1–PG20, `design/incoming/Programs Page.dc.html`) from the reads that exist.
One home for every program the studio runs: the catalogue at
`/admin/programs`, and a page per program with its tabs as static sub-paths.
Every address takes `guard(['admin'])`, never `hqOnly`; a Super Admin gets the
HQ view (PG2) wherever they open it, chosen by elevation.

The routed files, each one `AdminBoardFrame` named for its board, with the
page in a child component inside it:

- `ProgramsCatalogue.jsx` — board S19, workspace "Programs":
  `/admin/programs`. The header with the scope chip and "Updated", the three
  tiles, the group chips, the nine cards (each door a literal `to`), and the
  foot's one door to Profiling trends.
- `MentorCohortAccess.jsx` — board S18 (and S21), workspace "Advisor cohort
  access": `/admin/programs/mentor-cohorts` (Overview), `/how-it-runs` and
  `/people`. People mounts `AdvisorCohortAssignmentsBody` from
  `../AdvisorCohortAssignments.jsx`.
- `ReferAndEarn.jsx` — board S9, workspace "Referrals":
  `/admin/programs/refer-and-earn` (Overview), `/how-it-runs`, `/queue` and
  `/settings`. Queue mounts `ReferralReviewBody` from `../ReferralReview.jsx`.
- `ProgramPage.jsx` — workspace "Programs": Perks (`/admin/programs/perks`,
  `/how-it-runs`, `/queue`), Learning (`/admin/programs/learning`,
  `/how-it-runs`, `/people`), Referral partners
  (`/admin/programs/referral-partners`, `/how-it-runs`), and the one-page
  `/admin/programs/investor-cohorts` and `/admin/programs/ai-native-venture`.

The pieces they draw with:

- `ProgramFrame.jsx` — every program page's crumb, header, facts strip and
  moved notice.
- `ProgramTabs.jsx` — each program's tab strip, as literal `NavLink`s.
- `PerksPages.jsx` — Perks' Overview tiles and its review Queue.
- `LearningPages.jsx` — Learning's Overview (tiles and programs table) and
  People.
- `ReferralPartners.jsx` — Referral partners' Overview links and its header
  action.
- `parts.jsx` — the tile, skeleton, Unreadable, placeholder, pills, moved
  notice and How it runs, over Partner invitations' card and chips.
- `useProgramReads.js` — the reads, each made alone.
- `programsModel.js` — pure. The addresses and moved keys, the nine programs
  (S-RUN), each page's header, facts, tabs and How it runs text, Guard L, the
  bands, Waiting for you, the mentor counts (S-CNT, S-COV), the Refer & Earn,
  Perks and Learning figures, the scope chip and the refusals.

The redirects, each the route's whole element:

- `HeldProgramsRedirect.jsx` — `/admin/held/programs` → `/admin/programs?moved=held`.
- `AdvisorCohortsRedirect.jsx` — `/admin/advisor-cohorts` →
  `/admin/programs/mentor-cohorts/people?moved=advisor-cohorts`.
- `ReferEarnRedirect.jsx` — `/admin/refer-earn` →
  `/admin/programs/refer-and-earn/queue?moved=refer-earn`.

## Rules

- The pages read only D953 §2's R1–R12, through existing clients. They add no
  `/api/*` client. They never read `GET /api/admin/spinout-applications` or
  `GET /api/admin/spinout-participants`, which answer `[]` on any error
  (Guard H): Lab applications read "Not read here yet".
- A failed read marks only the blocks it feeds, with what could not be read,
  "That is not the same as none." and Try again. It is never a zero.
- A list at its cap says what it covers (Guard L): "200+", "within the newest
  500", "at least [n]".
- The words are D915's: "Not recorded", "Not read here yet" and "Could not be
  read", each with its reason as a visible line.
- A refusal is one sentence in place, keyed on its `code`.
- Nothing D953 §3 lists under "Not drawn now" is drawn: no chart, no period
  control, no Propose a program, no Pause, no CSV, no studio filter.

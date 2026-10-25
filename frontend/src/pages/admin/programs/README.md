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
  `/admin/programs`. D961 (#2794) completes it on part 1's read: the header
  with the scope chip, a Super Admin's Studio select, "Updated" and Refresh;
  the period control (4, 12 or 52 weeks, `?weeks=`); four tiles; Joins per
  week, Waiting by program and Credits in and out by month (the last two
  hidden on a phone); "Catalogue · [n] programs" with the group chips and the
  cards (each door a literal `to`); and the foot's one door to Profiling
  trends.
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
  notice and How it runs, over Partner invitations' card and chips; and
  D961's chart block (its skeleton, Unreadable and Chart/Table switch), the
  period control and the Studio select.
- `useProgramReads.js` — the reads, each made alone. The catalogue reads
  `adminProgramsApi.catalogue` (`GET /api/admin/programs`, D954) and Lab
  applications' `counts.pending` (`GET /api/admin/spinout-applications`, D960).
- `catalogueModel.js` — pure. D961's period, the four tiles, the three
  charts' series, rows and tables, the cards from the registry, Lab
  applications and the studio chip, each from one block of part 1's read.
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

- The pages read D953 §2's R1–R12 and, from D961, part 1's catalogue read
  through `lib/api/adminPrograms.js` and Lab applications through
  `GET /api/admin/spinout-applications`, whose failure is a 503 since D960.
  They never read `GET /api/admin/spinout-participants`, which still answers
  `[]` on any error (Guard H).
- A failed read marks only the blocks it feeds, with what could not be read,
  "That is not the same as none." and Try again. It is never a zero.
- A list at its cap says what it covers (Guard L): "200+", "within the newest
  500", "at least [n]".
- The words are D915's: "Not recorded", "Not read here yet" and "Could not be
  read", each with its reason as a visible line.
- A refusal is one sentence in place, keyed on its `code`.
- The charts are `ui/Charts.jsx`'s, never an `<svg>` of their own. Nothing
  else D953 §3 lists under "Not drawn now" is drawn: no Propose a program, no
  Pause, no CSV.

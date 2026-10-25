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
  access": `/admin/programs/mentor-cohorts` (Overview), `/how-it-runs`,
  `/people` and `/activity` (D962). People mounts `AdvisorCohortAssignmentsBody`
  from `../AdvisorCohortAssignments.jsx`.
- `ReferAndEarn.jsx` — board S9, workspace "Referrals":
  `/admin/programs/refer-and-earn` (Overview), `/how-it-runs`, `/queue`,
  `/settings` and `/activity` (D962). Queue mounts `ReferralReviewBody` from
  `../ReferralReview.jsx`.
- `ProgramPage.jsx` — workspace "Programs": Perks (`/admin/programs/perks`,
  `/how-it-runs`, `/queue`, `/activity`), Learning (`/admin/programs/learning`,
  `/how-it-runs`, `/people`, `/activity`), Referral partners
  (`/admin/programs/referral-partners`, `/how-it-runs`), and the one-page
  `/admin/programs/investor-cohorts` and `/admin/programs/ai-native-venture`.

The pieces they draw with:

- `ProgramFrame.jsx` — every program page's crumb, header, facts strip and
  moved notice.
- `ProgramTabs.jsx` — each program's tab strip, as literal `NavLink`s.
- `PerksPages.jsx` — Perks' Overview (tiles, Top perks by claims, Claims per
  week, Grant or deduct credits) and its Queue on every listing state, each
  review a dialog (D962).
- `LearningPages.jsx` — Learning's Overview (tiles, Completion by program,
  Enrolments per week, the programs table with assigned admins), People and
  the learner's record (D962).
- `ReferralPartners.jsx` — Referral partners' Overview links and its header
  action.
- `parts.jsx` — the tile, skeleton, Unreadable, placeholder, pills, moved
  notice and How it runs, over Partner invitations' card and chips.
- `ActivityTab.jsx` — a program's Activity tab, and Mentor's Recent
  activity, on part 1's activity read (D962).
- `PlaybookEditor.jsx` — How it runs from part 1's playbook store, with the
  Super Admin's Edit and Publish dialogs (D962). Part 10 reuses it.
- `MentorDialogs.jsx` — Mentor cohort access's Assign a mentor and End access
  dialogs, opened from Overview, People and the header (D962).
- `useProgramReads.js` — the reads, each made alone.
- `programPagesModel.js` — pure. D962's rules on parts 1, 4 and 7's reads:
  activity sentences, the playbook, the mentor figures and People's columns,
  D957's referral moves, the perk dialogs, OD9's Done and Finished, and the
  refusal sentences keyed on `code`.
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

- The pages read D953 §2's R1–R12 and, from D962, parts 1, 4 and 7's reads
  (`programPagesModel.js` lists them). Part 1's reads go through
  `frontend/src/lib/api/programs.js`; the rest through their existing clients. They never read `GET /api/admin/spinout-applications` or
  `GET /api/admin/spinout-participants`, which answer `[]` on any error
  (Guard H): Lab applications read "Not read here yet".
- A failed read marks only the blocks it feeds, with what could not be read,
  "That is not the same as none." and Try again. It is never a zero.
- A list at its cap says what it covers (Guard L): "200+", "within the newest
  500", "at least [n]".
- The words are D915's: "Not recorded", "Not read here yet" and "Could not be
  read", each with its reason as a visible line.
- A refusal is one sentence in place, keyed on its `code`.
- Every write opens a dialog (N9), and its result or refusal sits in the
  dialog. There is no corner toast.
- Every figure states its window, because a program page has no period
  control (S-PER). Charts are `frontend/src/ui/Charts.jsx`'s (D893, moved by D929).
- Still not drawn: no period control, no Propose a program, no Pause, no CSV,
  no studio filter, no Terms tab (part 1's store holds no program's terms).

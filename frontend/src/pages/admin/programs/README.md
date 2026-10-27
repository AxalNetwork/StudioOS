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
  (`/admin/programs/referral-partners`, `/how-it-runs`, `/queue`, `/activity`),
  Investor cohort access (`/admin/programs/investor-cohorts`, `/activity`) and
  the one-page `/admin/programs/ai-native-venture`. D963 (#2796) completes the
  last three on parts 1, 5 and 6's reads; each header's status pill is part
  1's registry's.

- `ProposePage.jsx` — D964 (#2797), workspace "Programs":
  `/admin/programs/propose`, Propose a program (PG14) on part 2's proposal
  routes. `?proposal=<uid>` opens a stored proposal: a Draft or Sent back one
  in the form, any other read only with HQ's note.
- `ProposalsPage.jsx` — D964, workspace "Programs": `/admin/programs/proposals`.
  A Super Admin gets the tab strip and Proposals from studios; an Admin gets
  PG19b in the page. It also holds `ProgramsTabs`, the strip "Catalogue ·
  Proposals [n]" the catalogue draws for a Super Admin.

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
- `ReferralPartners.jsx` — Referral partners (PG7, D963): Overview's segment
  chips, four tiles, Introductions by outcome, Commission by month, Standard
  rules, D923's links and the partners table with its row menu; the Queue of
  terms sent to HQ; and the header action, on part 5's reads
  (`../../../lib/api/referralPartners.js`).
- `ReferralTermsDialogs.jsx` — D963: Custom terms (PG8), Approve (the Super
  Admin's, behind the step-up bar), Send contract (the preview, then the
  send), End terms and a standard rule's edit (Commissions' `RuleEditor`).
- `InvestorCohorts.jsx` — D963: Investor cohort access (PG11) Overview, with
  the NDA template's state, four tiles, How it runs and the Investors table;
  Give an investor access (PG11d) and End access, on part 6's reads
  (`../../../lib/api/investorCohorts.js`).
- `ReferRewards.jsx` — D965 (#2798): Refer & Earn Overview's Rewards issued
  tile and Rewards card, each on its own read (part 4's paged total and
  `GET /api/refer-earn/admin/rewards`), with the words from
  `frontend/src/lib/referralRewards.js`.
- `parts.jsx` — the tile, skeleton, Unreadable, placeholder, pills, moved
  notice and How it runs, over Partner invitations' card and chips; and
  D961's chart block (its skeleton, Unreadable and Chart/Table switch), the
  period control and the Studio select.
- `ActivityTab.jsx` — a program's Activity tab, and Mentor's Recent
  activity, on part 1's activity read (D962).
- `PlaybookEditor.jsx` — How it runs from part 1's playbook store, with the
  Super Admin's Edit and Publish dialogs (D962). D963 reuses it for Referral
  partners, Investor cohort access and AI-native Venture (PG13s).
- `MentorDialogs.jsx` — Mentor cohort access's Assign a mentor and End access
  dialogs, opened from Overview, People and the header (D962).
- `useProgramReads.js` — the reads, each made alone. The catalogue reads
  `adminProgramsApi.catalogue` (`GET /api/admin/programs`, D954) and Lab
  applications' `counts.pending` (`GET /api/admin/spinout-applications`, D960).
- `catalogueModel.js` — pure. D961's period, the four tiles, the three
  charts' series, rows and tables, the cards from the registry, Lab
  applications and the studio chip, each from one block of part 1's read.
- `ProposalTables.jsx` — D964: Your proposals (PG1, an Admin's) and
  Proposals from studios (PG2, a Super Admin's), each on its own read, with
  search, status, sort and pages.
- `ProposalFields.jsx` — D964: PG14's Basics and How it runs fields, shared by
  Propose a program and New program.
- `DecideDialog.jsx` — D964: PG15a, a Super Admin's decision on one proposal.
- `NewProgramDialog.jsx` — D964: New program (PG2's header), for a Super Admin.
- `proposalsModel.js` — D964, pure: the proposal's statuses, PG14's steps and
  lists, the Review lines, PG15a's choices, PG19b, the list parameters and the
  refusals.
- `referralPartnersModel.js` — D963, pure: the segments and terms words, the
  tiles, the two charts (one currency per chart), the rules' lines, the
  table's query and row menu, PG8's form, body and live sentence, the
  triggers that fire today, and part 5's refusals.
- `investorCohortsModel.js` — D963, pure: the access and NDA words, the
  tiles, the grants' query, PG11d's cohorts, body and lines, and part 6's
  refusals.
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

- The pages read D953 §2's R1–R12; from D961, part 1's catalogue read
  through `frontend/src/lib/api/adminPrograms.js` and Lab applications through
  `GET /api/admin/spinout-applications`, whose failure is a 503 since D960;
  from D962, parts 1, 4 and 7's reads (`programPagesModel.js` lists them; part
  1's go through `frontend/src/lib/api/programs.js`); and, from D964, part 2's
  proposal routes through `../../../lib/api/programProposals.js`. They never
  read `GET /api/admin/spinout-participants`, which still answers `[]` on any
  error (Guard H).
- A failed read marks only the blocks it feeds, with what could not be read,
  "That is not the same as none." and Try again. It is never a zero.
- A list at its cap says what it covers (Guard L): "200+", "within the newest
  500", "at least [n]".
- The words are D915's: "Not recorded", "Not read here yet" and "Could not be
  read", each with its reason as a visible line.
- A refusal is one sentence in place, keyed on its `code`.
- Every write opens a dialog (N9), and its result or refusal sits in the
  dialog. There is no corner toast.
- The charts are `frontend/src/ui/Charts.jsx`'s (D893, moved by D929), never an
  `<svg>` of their own. A program page has no period control (S-PER), so every
  figure there states its window; the catalogue's period control is D961's.
- Still not drawn: no Pause, no CSV, no Terms tab (part 1's store holds no
  program's terms). D963 leaves out Offer to studios (#2376), sending the
  cohort NDA (part 6 refuses it until HQ publishes the template), the cohort's
  founder count (O-FND), and PG8's Studio and Payout method. D964 drew the proposal flow (Propose, the two lists,
  Decide, New program, PG19b) on part 2's routes, through
  `../../../lib/api/programProposals.js`.

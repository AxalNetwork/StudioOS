# Lab

D937 (#2374): the Spin-Out Lab's admin page at `/admin/programs/spinout-lab`,
built to the owner's canvas (SL1–SL21, `design/incoming/Spin-Out Lab Admin Page.dc.html`)
under the shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`).
Its tabs are sub-paths: `/applications` (one application at `/applications/:id`, D948), `/cohorts` (and one cohort at
`/cohorts/YYYY-MM`, D947), `/participants` (one founder at `/participants/:uid`, D949), `/hosts`,
`/formation`, `/graduation`, `/how-it-runs`, `/settings` and `/activity`; the founder-journey preview is `/preview`.

Three old doors forward here before any old console mounts, keeping the query
and hash and adding `?moved=`:
- `/admin?tab=lab-applications` → `/applications` (`../LegacyContractsRedirect.jsx`);
- `/admin/spinout-lab` → the Lab (`LabRedirect.jsx`), kept for good: sent
  cohort notices carry it;
- `/admin/spinout-lab/preview` → `/preview` (`LabPreviewRedirect.jsx`).

- `AdminLab.jsx` — the page: the header (crumb, pills, line, facts, scope chip,
  moved notice, tabs with their counts) and the Overview's blocks.
  Applications, Participants, Cohorts, Hosts, Formation and Graduation mount
  the files below; under Applications, `AdminSpinoutLab`'s `cycles` section
  keeps Settings' minimum and places and the two logs until part 9 (#2756).
- `LabOverviewBlocks.jsx` — Overview's drawn blocks (SL1, D947): the cohort
  calendar timeline, Applications by cohort, Weeks passed, From application
  to company and Applications per week, each with Chart ⇄ Table and its
  Reading…, Unreadable with Try again, and empty states.
- `LabCohorts.jsx` — Cohorts (D947): SL5's calendar of the next twelve cohorts
  or the list, and SL6, one cohort at `/cohorts/YYYY-MM`. Grace and outcome
  overrides there are still today's `AdminCohortTiming` until part 7.
- `labOverviewModel.js` — pure. Those blocks and pages from D944's overview
  read (`GET /api/admin/cohort/overview`) and Settings' minimum and places.
- `LabApplications.jsx` — Applications (SL2) and one application (SL3, D948):
  the cohort switch, the status chips with the Worker's totals, the capacity
  bar and the below-the-minimum callout, search, filters, sort, the bulk bar
  and pages asked of D944's read, the table (cards on a phone), the drawer at
  `/applications/:id` from D948's read, and SL4 A–G's dialogs (Approve,
  Waitlist, Decline, Move, Schedule an interview, Run below the minimum, Admit
  without an application). `AdmitDialog` is exported for the Users console.
- `applicationsModel.js` — pure. Applications' words, query, rows, cohort
  switch, capacity, the drawer's sections, the dialogs' copy and refusals, and
  ET-to-UTC for an interview time.
- `LabParticipants.jsx` — Participants (SL7) and one founder (SL8, D949): the
  segments and "Where [cohort] stands" from D946's read, its filters, sort and
  pages asked of the Worker, the table (cards on a phone), the drawer at
  `/participants/:uid`, and the Give grace, Change this week and Open
  workspace dialogs (SL8a–c).
- `participantsModel.js` — pure. Participants' words, rows, standing bar,
  filters, the drawer's sections and the dialogs' copy, on the Lab's clock.
- `LabHosts.jsx` — Hosts (SL9, D970): status chips with the Worker's counts,
  search, Applied as and the sort, the table (cards on a phone), and the
  Approve, Decline and Remove dialogs with a note the host sees.
- `LabFormation.jsx` — Formation (SL10, SL10d; D970): the 83(b) operator
  review (assign, record a review) and the formation orders (mark the packet
  ready, record the filing date), each read alone, each write in a dialog with
  nothing preselected. The "Lab ventures" switch waits for part 4 (#2751).
- `LabGraduation.jsx` — Graduation (SL11, SL11r; D970): the four tiles
  (Emailed and Downloaded "Not recorded"), Issue all eligible with its
  result, the table, and the Issue and Revoke dialogs (a reason required).
- `labDesksModel.js` — pure. Those three tabs' words, rows, filters, sorts,
  dialog copy and refusals, and the Lab's day (ET; stored stamps are UTC).
- `labParts.jsx` — what the three tabs draw with: pills, chips, selects, the
  read hook and its state line, tiles, the pager and the in-page dialog.
- `labModel.js` — pure. The address and tabs, the moved sentences, and the
  Overview's tiles and Needs you from the reads, each `ready`,
  `loading` or `unreadable`.
- `LabRedirect.jsx`, `LabPreviewRedirect.jsx` — the two old paths.

## Rules

- Every figure comes from a read that exists today (D937 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- Guard H (D953 §2): `GET /api/admin/spinout-applications` and
  `GET /api/admin/spinout-participants` answer `[]` with 200 on an error, so no
  figure here comes from them. Participants reads D946's
  `GET /api/admin/cohort/participants`, which says when it fails (D949).
- No rail. D317 keeps Eadwyn out of the Lab; `NO_RAIL_ROUTES` covers the whole
  subtree.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
- Dates are the Lab's rule and cannot be moved here. Times are ET.

D971 (#2756), SL12–SL14 and SL21:
- `LabHowItRuns.jsx` reads the published playbook. Super Admin draft edits and
  publishing use separate in-page dialogs; the monthly checklist and admin tools
  link to the live desks. The calendar links to the live cohort calendar rather
  than copying a sample chart into the playbook.
- `LabSettings.jsx` reads operative cohort size, edits Minimum or Places in a
  dialog, reads a selected licensed studio's grant for a Super Admin, and draws
  the fixed rules. An Admin's grant terms wait explicitly for #2775.
- `LabActivity.jsx` reads the Worker's filtered and paged history. Super Admin
  support sessions read separately and search/page over the newest 100 records;
  an Admin makes no support-session request.
- `labOperationsModel.js` holds words, ET stamps, validators and support paging;
  `labOperationsParts.jsx` gives these tabs their explicit Unreadable / Try again
  block while reusing the shared loading and stale states.

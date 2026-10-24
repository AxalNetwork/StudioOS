# Lab

D937 (#2374): the Spin-Out Lab's admin page at `/admin/programs/spinout-lab`,
built to the owner's canvas (SL1–SL21, `design/incoming/Spin-Out Lab Admin Page.dc.html`)
under the shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`).
Its tabs are sub-paths: `/applications`, `/cohorts`, `/participants`, `/hosts`,
`/formation` and `/graduation`; the founder-journey preview is `/preview`.

Three old doors forward here before any old console mounts, keeping the query
and hash and adding `?moved=`:
- `/admin?tab=lab-applications` → `/applications` (`../LegacyContractsRedirect.jsx`);
- `/admin/spinout-lab` → the Lab (`LabRedirect.jsx`), kept for good: sent
  cohort notices carry it;
- `/admin/spinout-lab/preview` → `/preview` (`LabPreviewRedirect.jsx`).

- `AdminLab.jsx` — the page: the header (crumb, pills, line, facts, scope chip,
  moved notice, tabs with their counts) and the Overview's blocks.
  Applications, Cohorts and Participants are today's console, asked for one
  section through `AdminSpinoutLab`'s `section` prop; Hosts, Formation and
  Graduation mount the three files below.
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
  Overview's tiles, cohort table and Needs you from the reads, each `ready`,
  `loading` or `unreadable`.
- `LabRedirect.jsx`, `LabPreviewRedirect.jsx` — the two old paths.

## Rules

- Every figure comes from a read that exists today (D937 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- Guard H (D953 §2): `GET /api/admin/spinout-applications` and
  `GET /api/admin/spinout-participants` answer `[]` with 200 on an error, so no
  figure here comes from them, and the Participants tab's count is a dash.
- No rail. D317 keeps Eadwyn out of the Lab; `NO_RAIL_ROUTES` covers the whole
  subtree.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
- Dates are the Lab's rule and cannot be moved here. Times are ET.

# frontend/src/pages/account/companies — Companies and projects

Account › Companies and projects at `/account/companies` (D1134, #2422), built
to the owner's canvas: `design/incoming/Companies Projects Page.dc.html` and
`design/incoming/Companies and projects · Boards.dc.html` (CMP1–CMP19).

| File | What it is |
|---|---|
| `CompaniesProjects.jsx` | The pane `SettingsPage.jsx` draws for the `companies` section: Companies (the switcher's own read), Projects (a founder's ventures by company) and Invitations. |
| `companiesModel.js` | Pure: the tabs, the words, and the derivations from the reads (the cards, the cycles line, the ventures grouped by company). |

## The rules for adding here

- **The active company is this device's.** It lives in the browser
  (`active_company_id`); `/me` carries none. Say "Active on this device".
- **Never the every-project read for another profile.** `GET /api/projects`
  answers every venture to an investor or an Operating Partner; only a
  founder's own list is read here until part 2's `GET /api/account/projects`.
- **A failed or missing read is said, never drawn as none.** A cycle list the
  Worker could not read is "could not be read"; a failed memberships read is
  Unreadable, not "you belong to none".

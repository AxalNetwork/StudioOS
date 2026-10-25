# frontend/src/pages/account/companies — Companies and projects

Account › Companies and projects at `/account/companies` (D1134, #2422; completed by D1138, #3018), built
to the owner's canvas: `design/incoming/Companies Projects Page.dc.html` and
`design/incoming/Companies and projects · Boards.dc.html` (CMP1–CMP19).

| File | What it is |
|---|---|
| `CompaniesProjects.jsx` | The pane `SettingsPage.jsx` draws for the `companies` section. Its tabs are addresses of their own (`/account/companies`, `/projects`, `/funds`, `/engagements`, `/invitations`), each profile's own (`tabsFor`), each read its own block. |
| `CompaniesDialogs.jsx` | The two in-page dialogs: answering an invitation addressed to you, and New company. |
| `companiesModel.js` | Pure: the profiles and their tabs, the tab addresses, the words, and the derivations from the reads (the cards, the ventures grouped, the invitations, the funds by firm, the engagements, the tab counts). |

## The rules for adding here

- **The active company is this device's.** It lives in the browser
  (`active_company_id`); `/me` carries none. Say "Active on this device".
- **Never the every-project read.** `GET /api/projects` answers every venture
  to an investor or an Operating Partner; this page reads part 2's
  `GET /api/account/projects`, the caller's own and seated ventures.
- **Each block says what it holds.** Part 2's figures are blocks; one that
  could not be read says so ("Members: could not be read"), never 0, and one
  failed read never blanks another tab.
- **Every change is an in-page dialog** that says what it changes first; a
  refusal is said inside it. An Explorer is never offered New company.
- **A failed or missing read is said, never drawn as none.** A cycle list the
  Worker could not read is "could not be read"; a failed memberships read is
  Unreadable, not "you belong to none".

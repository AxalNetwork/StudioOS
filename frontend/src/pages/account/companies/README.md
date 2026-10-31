# frontend/src/pages/account/companies — Companies and projects

Account › Companies and projects at `/account/portfolio` (D1415 part 4, #3856; it was `/account/companies`, D1134, #2422; completed by D1138, #3018), built
to the owner's canvas: `design/incoming/Companies Projects Page.dc.html` and
`design/incoming/Companies and projects · Boards.dc.html` (CMP1–CMP19).

| File | What it is |
|---|---|
| `CompaniesProjects.jsx` | The pane `SettingsPage.jsx` draws for the `companies` section. Its tabs are addresses of their own (`/account/portfolio`, `/projects`, `/funds`, `/engagements`, `/invitations`), each profile's own (`tabsFor`), each read its own block. |
| `CompaniesDialogs.jsx` | The two in-page dialogs: answering an invitation addressed to you, and New company (with the name clash said under the field, D1139). |
| `CompanyLightbox.jsx` | The company sheet (CMP2, D1139; the shared `Sheet`, D1317, docked to the window edge over the list; closing returns to `/account/portfolio`) at `/account/portfolio/<uid>`: facts, ventures in the company, members, invitations, and the buttons the caller's place in the company allows. |
| `VentureLightbox.jsx` | The venture sheet (CMP4, CMP4b, D1139; the shared `Sheet`, D1317): facts, team, invitations or the Worker's Lab lock, and the owner's or a team member's acts. |
| `LifecycleDialogs.jsx` | The lifecycle dialogs (CMP6–CMP8, D1139) on one shell, `ActionDialog`: Rename, Make active, Invite people, Transfer primary admin, Archive, Restore, Leave and its refusal, Move, Transfer ownership, Leave a venture, Move to trash, Remove. |
| `CompaniesMoved.jsx` | D1140 (#3020, CMP19): `CompanySettingsRedirect`, which forwards `/company-settings` to the active company's page (or the Companies tab) with the query and hash kept and `?moved=company-settings`; the notice that draws on arrival; and Profile and identity's line where "Your companies" was, shown until dismissed on this device. D1415 part 4 (#3856): `CompaniesMovedRedirect`, which forwards every old `/account/companies…` address to the same place under `/account/portfolio` (`movedCompaniesTarget`), query and hash kept, `?moved=companies`. |
| `CompanySettingsAt.jsx` | D1140: the full company settings (`CompanySettingsPage`, unchanged) at `/account/portfolio/<uid>/settings` for the company active on this device. `/account/portfolio/settings` opens the active company's, or with none, Firm or Practice Settings and the on-ramp. Lazy-loaded by `App.jsx`. |
| `companiesModel.js` | Pure: the profiles and their tabs, the tab and company addresses, the words, and the derivations from the reads (the cards, the ventures grouped, the invitations, the funds by firm, the engagements, the tab counts); D1139's `LIFECYCLE` words and who may do what (`companyPowers`, `ventureTeam`). |

## The rules for adding here

- **Every address comes from the constants** (`BASE_PATH`, `TAB_PATHS`,
  `companyPathFor`, `SETTINGS_PATH`, `companySettingsPathFor`). The old
  `/account/companies…` addresses only forward (D1415 part 4); never link to
  one, and never rename a label here before #3696's naming question is answered.

- **`settings` is reserved** (D1140). It is never a company uid or a tab:
  `companyUidFor` and `settingsUidFor` both refuse it, and its two routes sit
  before `/account/portfolio/:tab` in `App.jsx`.

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
  A dialog's words live in `LIFECYCLE`, so a test reads them without a browser.
- **Who may act is the Worker's rule, and the Worker decides.** A button
  follows the caller's place (`companyPowers`, `ventureTeam`), and a refusal
  the page could not foresee (`last_primary_admin`) turns into its own
  dialog with the reason. The Lab lock is the Worker's `gate_reason`, never
  worked out here.
- **A failed or missing read is said, never drawn as none.** A cycle list the
  Worker could not read is "could not be read"; a failed memberships read is
  Unreadable, not "you belong to none".

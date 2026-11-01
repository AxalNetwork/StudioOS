# frontend/src/pages/account/companies — Portfolio

Account › Portfolio at `/account/portfolio` (D1413, #3696: "Companies and projects" until the owner named it; the address is D1415 part 4, #3856; it was `/account/companies`, D1134, #2422; completed by D1138, #3018), built
to the owner's canvases: `design/incoming/Companies Projects Page.dc.html` and
`design/incoming/Companies and projects · Boards.dc.html` (CMP1–CMP19), then
`design/incoming/Portfolio Account Page.dc.html` and `design/incoming/Portfolio · Boards.dc.html` (PF1–PF8, D1413).

| File | What it is |
|---|---|
| `CompaniesProjects.jsx` | The pane `SettingsPage.jsx` draws for the `companies` section. Its tabs are addresses of their own (`/account/portfolio`, `/projects`, `/funds`, `/engagements`, `/invitations`), each profile's own (`tabsFor`), each read its own block. |
| `CompaniesDialogs.jsx` | Answering an invitation addressed to you, in an in-page dialog (D1138). New company moved to `CreateSheets.jsx` (D1413). |
| `PortfolioOverview.jsx` | D1413 (PF1, PF7): the Companies tab. Each company a card (status, jurisdiction, entity type, team, location from D1412's summary; its address from the switcher) with its projects nested; then standalone projects (Make it a company → Incorporate) and seats on other ventures. A failed projects read is "Its projects could not be read" under each card alone. |
| `CompanyPage.jsx` | D1413 (PF2, PF7c): the company's page at `/account/portfolio/<uid>`, which replaced D1139's lightbox (owner Q3) and hosts its dialogs. Legal information, Locations, Documents, Team and Projects, each a block that fails alone. |
| `ProjectPage.jsx` | D1413 (PF3): a project's page at `/account/portfolio/projects/<id>`: its linked company, or "Not a company yet" with Make it a company and Move under a company; details and team. |
| `CreateSheets.jsx` | D1413 (PF4): New company (only the name is required, owner Q2; the address and legal fields optional) and New project (standalone or in a company; the address checked as you type, D1591). |
| `CompanySettingsTabs.jsx` | D1413 (PF6a, PF6c, PF8): Company settings' head and tabs, the General card ("Default currency" reads "Coming later" until #3932), Legal (the facts and `LegalSheet`), and Projects (each project's settings inside the company, Agents and Move out). |
| `LegalSheet.jsx` | D1413 (PF8a): "Edit legal facts": the legal record, the tax ID (masked, Replace), the registered agent and the mailing address. No Ask on Account (owner Q8). |
| `PortfolioAddress.jsx` | D1413: `/c/<company>[/p/<project>]` and `/p/<project>` (with an optional `/settings[/<tab>]`), resolved by `GET /api/account/resolve` and opened under Account in one hop; anything else is "This is not yours to open". Routed by `frontend/src/routes/portfolio.jsx`. |
| `portfolioAdapter.js` | D1413: the one seam to the Worker beyond D1136 (the switcher, settings scope, resolve, the legal record, documents, slug check, a project's agents). Unbuilt routes answer unavailable with their issue (`defaultCurrency`, #3932). |
| `portfolioUi.jsx` | D1413: the marks, the type badge, the address chip, a fact ("Not recorded" muted, never 0), the card and the failed block. |
| `VentureLightbox.jsx` | The venture sheet (CMP4, CMP4b, D1139; the shared `Sheet`, D1317): facts, team, invitations or the Worker's Lab lock, and the owner's or a team member's acts. |
| `LifecycleDialogs.jsx` | The lifecycle dialogs (CMP6–CMP8, D1139) on one shell, `ActionDialog`: Rename, Make active, Invite people, Transfer primary admin, Archive, Restore, Leave and its refusal, Move, Transfer ownership, Leave a venture, Move to trash, Remove. |
| `CompaniesMoved.jsx` | D1140 (#3020, CMP19): `CompanySettingsRedirect`, which forwards `/company-settings` to the active company's page (or the Companies tab) with the query and hash kept and `?moved=company-settings`; the notice that draws on arrival; and Profile and identity's line where "Your companies" was, shown until dismissed on this device. D1415 part 4 (#3856): `CompaniesMovedRedirect`, which forwards every old `/account/companies…` address to the same place under `/account/portfolio` (`movedCompaniesTarget`), query and hash kept, `?moved=companies`. |
| `CompanySettingsAt.jsx` | D1140: the full company settings (`CompanySettingsPage`, unchanged) at `/account/portfolio/<uid>/settings` for the company active on this device, under D1413's head, tabs and General card. `/account/portfolio/settings` opens the active company's, or with none, Firm or Practice Settings and the on-ramp. Lazy-loaded by `App.jsx`. |
| `companiesModel.js` | Pure: the profiles and their tabs, the tab and company addresses, the words, and the derivations from the reads (the cards, the ventures grouped, the invitations, the funds by firm, the engagements, the tab counts); D1139's `LIFECYCLE` words and who may do what (`companyPowers`, `ventureTeam`). |

## The rules for adding here

- **Every address comes from the constants** (`BASE_PATH`, `TAB_PATHS`,
  `companyPathFor`, `SETTINGS_PATH`, `companySettingsPathFor`). The old
  `/account/companies…` addresses only forward (D1415 part 4); never link to
  one. The section is "Portfolio" (D1413, owner Q1); an investor's `/portfolio`
  is their holdings, and each links to the other.

- **The Worker beyond D1136 is reached through `portfolioAdapter.js`.** A route
  that is not on main answers unavailable there, with the issue it waits on;
  no client method is added before its route.

- **A standalone project has no Legal anywhere.** Legal is a company's
  (Company settings › Legal); a standalone project's settings are Team's
  Project settings › General.

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

# Companies and projects map — 2026-10-25

The owner's Companies and projects canvas (#2422, boards CMP1–CMP19), read against the code on `origin/main` at `32cd64750d`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1134.

## 1. The canvas

`design/incoming/Companies and projects · Boards.dc.html` holds the board grid, which imports `Companies Projects Page.dc.html`.

| Boards | What they draw |
|---|---|
| CMP1–CMP5 | Companies (founder), the company lightbox, Projects, the venture lightbox (CMP4b once the Lab reaches Week 4), Invitations (CMP5e nothing waiting) |
| CMP6–CMP8 | Dialogs: new company, rename, make active, invite; transfer, archive, leave and its refusal; move a venture, transfer ownership, leave a venture, trash |
| CMP9–CMP13 | Investor, Operating Partner, Advisor, Explorer, Admin and Super Admin |
| CMP14–CMP18 | Empty, loading, error and partial, no permission, phone |
| CMP19 | Hand-off: the switcher's Manage link, the renamed sidebar row, the moved notices |

## 2. #2422's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | "Leave company" fails for ordinary members | **Open**: the delete-member route needs an editor (`routes/company.ts`, `canEdit`) |
| 2 | After leaving, the switcher still lists the company | Open (it follows item 1) |
| 3 | "Manage" on "Your companies" opens the active company, not the row's | **Open** (`SettingsPage.jsx`, `to="/company-settings"`) |
| 4 | Explorers can create a company they cannot open | **Open**: `POST /company/create` has no role check |
| 5 | Rename skips create's rules | **Open** |
| 6 | Operating Partners can trash any venture and change any team | **Fixed** by D889 (#2438) |
| 7 | Trashed ventures count against the free cap | **Open** (`routes/projects.ts`, the cap's `COUNT(*)` has no `deleted_at` filter) |
| 8 | Project invitations send no email | **Open** |
| 9 | No record of membership changes | Open |
| 10 | The firm's name lives in four places | Open |
| 11 | `GET /company/memberships` is heavy | Open |

## 3. What each tab can read today

| Tab | Read | Drawn by D1134 |
|---|---|---|
| Companies | `GET /api/company/memberships` | One card per company: role, primary admin, members, cycles in use (an unread list is "could not be read", never "none"), last opened, and "Active on this device" |
| Projects | `GET /api/projects`, for a founder only | The founder's ventures by company, then "Not in a company"; trashed ones left out. Other profiles: Not read here yet, because that read answers every venture to an investor or an Operating Partner |
| Invitations | none | Not read here yet |

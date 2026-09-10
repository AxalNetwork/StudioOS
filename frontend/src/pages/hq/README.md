# pages/hq — the Super Admin's HQ-only surfaces

What the franchisor sees that a plain admin does not. The Super Admin is an
elevation on `admin` (migration 199, one holder by 207), so every screen here
is reached through `guard(['admin'], hqOnly(...))` in `App.jsx`: the route
guard proves admin, `hqOnly` reads the elevation off `/me`, and the worker
re-checks with `requireSuperAdmin` on every call regardless.

| File | What it is |
| --- | --- |
| `SuperAdminOnlyNotice.jsx` | What an admin WITHOUT the elevation sees on an HQ-only route — a stated boundary inside the shell, never a bounce. |
| `SuperAdminHolders.jsx` | The holder console: who holds the elevation, grant, revoke. Writes need TOTP + a recent step-up; the last active holder cannot be revoked. |
| `AccountsPage.jsx` | The HQ "Team" row (canvas H4): the holder console above the Admin Console's Users panel, locked to that section. |
| `ContractsPage.jsx` | The HQ "Contracts" row: the master template library the platform holds. The doc-type registry the canvas draws above it has no store, and the page says so. |
| `HqHomePage.jsx` | The HQ "Home" row (canvas H1) at `/hq`: totals, one health card per licence, the licence trail and renewals, over `GET /api/admin/hq/overview`. The tenant switcher narrows this page only. |
| `ContentPage.jsx` | The HQ "Content" row (canvas H6) at `/admin/content`: the editorial pipeline over `articles` by real status, publications shown as the SECOND meaning of "published", and a link to the master template library rather than a second copy of it. **Not `/admin/articles`**, which is the plain-admin Content Queue that reviews one piece at a time. Localisation and brand approval render Not recorded — neither has a store. |
| `PlatformPage.jsx` | The HQ "Platform" row (canvas H6) at `/admin/platform`: integration connections by provider and state, and scheduled-job health where failed, silent and still-running are three distinct states. Read-only by construction — it has no controls, fetches no key material, and says so; reveal and revoke stay in the console that audits them. Feature flags render Not recorded: what the codebase calls flags is per-user settings. |
| `RevenuePage.jsx` | The HQ "Revenue" row (canvas H5) at `/admin/revenue`: licence fees per currency from the licence ledger and open disputes from Stripe; subscription revenue, the token margin, the per-subsidiary token P&L and the subsidiary statement ledger each render Not recorded with the reason. Rows are never summed across currencies. |
| `SecurityPage.jsx` | The HQ "Security" row (canvas Y2, decision A4) at `/admin/security`: the admin action audit, sessions and impersonations with the platform-wide force re-auth, KYC and deletion-request clocks; security events, AI safety, sanctions and DR named as not recorded. |

## Rules

- **Nothing here decides access.** `shellRoleFor` names a sidebar; `hqOnly`
  chooses between a page and the notice; the worker's `requireSuperAdmin` is
  the boundary. A page that assumed the shell implied the power would be wrong
  the moment someone typed the URL.
- **Per-tenant figures are not recorded.** No account carries a licence yet
  (`UNRESOLVED_ITEMS.md` U1), so anything the canvases show per subsidiary —
  accounts, revenue, backlog, a tenant column — renders as "Not recorded" with
  that reason, never as a sample or a zero.
- Dark mode is not optional; `npm run test:drift` runs `check-dark-mode`.

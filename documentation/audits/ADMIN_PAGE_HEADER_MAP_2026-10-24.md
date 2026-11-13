# Admin page header — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`cc35435fd5` by S21 for #2375, before D936 was written. `fe/` is
`frontend/src/`.

The canvas is `design/incoming/Admin page header.dc.html`, one page with a
`board` switch: SHL1–SHL9, SHL7 as SHL7a and SHL7b. #2375's body holds the route
map and the full inventory of old addresses; this map records what the header
can reuse and what each board needs.

## A. Board by board

| Board | What it draws | What exists on `main` | Where it goes |
|---|---|---|---|
| SHL1 | crumb, title, pill, one primary, More, line, scope chip, tab bar with counts; rail open | four pages draw their own header to these rules: Insights (`fe/pages/admin/insights/AdminInsights.jsx`), Community (`community/AdminCommunity.jsx`), the Events desk (`AdminEventsPage.jsx`), Partner invitations (`PartnerInvitations.jsx`); `fe/ui/` has no shared header | `fe/ui/AdminPageHeader.jsx` (D936); the four move onto it in part 1 |
| SHL2 | HQ page, strip lit, "HQ only" pill | `HQ_STRIPS` (`fe/lib/hqStrips.js`) and their links in `fe/App.jsx`; `stripFor` matches exact paths | part 1 |
| SHL3 | three moved notices, Dismiss focused | `?moved=` notices on Contracts (`LegacyContractsRedirect.jsx`), Insights, Community, Events, Partner invitations, each its own markup | `useMovedNotice` and the header's notice (D936) |
| SHL4 | loading: header whole, counts as bars | each page's own skeletons | the header's `load` count (D936) |
| SHL5 | empty body under a whole header | `EmptyState` (`fe/ui/index.js`) | each page |
| SHL6 | a count as a dash "Could not be read"; error card with Details | `Unreadable`, `ConsoleUnreadable` | the header's `dash` count (D936); the card is each page's |
| SHL7a | HQ-only notice card | `SuperAdminOnlyNotice` (`fe/pages/hq/SuperAdminOnlyNotice.jsx`), which links "Admin Console →" | part 3 |
| SHL7b | a member on an admin page | `RoleGuard` redirects home with no word (`fe/App.jsx`, the `Navigate` in `RoleGuard`) | part 3 |
| SHL8 | phone: back link, 20 px title, full-width primary, sideways tabs, 44 px targets | each page's own | the header's phone rules (D936) |
| SHL9 | SHL1 in dark | — | the header's dark classes (D936) |

## B. The Admin Console today

- `ADMIN_SECTIONS` (`fe/pages/AdminPage.jsx`) lists fourteen tabs, including Legal, which forwards to Contracts before the console mounts (`LegacyContractsRedirect.jsx`).
- After D937, `lab-applications` forwards the same way, to `/admin/programs/spinout-lab/applications`.
- Every other tab still renders under the title and dropdown. Part 1 moves each to #2375's address.

## C. Stale copy that names the Admin Console

#2375's "What is missing", item 10, holds the list. Part 5.

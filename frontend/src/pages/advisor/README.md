# Advisor pages

`AdvisorStudioHome.jsx` and `AdvisorWorkspaceShell.jsx` frame the advisor's
workspace; `advisorStudioHome.css` styles the home. `AdvisorPreviewNotice.jsx`
and `AdvisorSectionStub.jsx` explain previews and sections whose stores are
not yet available. `advisorEarnings.js` derives recorded earnings facts. `advisorToday.js` builds the Studio's Today list from the bookings, the calendar and the slots, and says which of the three failed or is still loading (D4620).

`AdvisorProfilePage.jsx` is the approved Ops A5 public profile.
`PublicAdvisorBookingPage.jsx` opens a session type's `/b/*` link and reuses
the directory booking dialog. Public responses omit account IDs and email;
booking still requires the existing authenticated role and subscription gates.

| Subfolder | Contents |
| --- | --- |
| `advisory/` | Clients, contracts and retained advisory tabs. |
| `cohorts/` | The Cohorts workspace (D4813): `CohortWorkspace.jsx` holds the one selected cohort (`?cohort=`), the header and the section tabs; `cohortModel.js` decides selection, stale-response discard, founder states and the Overview's items; `OverviewZone.jsx` is `/cohorts`; the five zones read through the shared selection. |
| `expertise/` | The advisor's own profile, services, proof, thinking and visibility (`VisibilityZone.jsx`, D1597 mounted by D1424: requests per booking link and opens of your writing; profile views "Not recorded"). The four lists read a page at a time through `pages.js` (`usePagedList`, D4689) and show whole-list figures. |
| `network/` | Relationships, introductions and organisations. |
| `practice/` | Opportunities, engagements, delivery, sessions and earnings. |

Add behaviour in the mounted Worker first, reuse the approved canvas, and keep
unknown facts Not recorded and failed reads Unreadable. New routes need
regressions and desktop/phone verification; do not invent another workspace.

Advisor `/studio` has no AI side rail, per the owner's 2026-10-21 request.
Its Eadwyn interview and practice modules remain. Other advisor boards retain
their existing rails; `NO_RAIL_ROUTES` records the Studio-only exception.

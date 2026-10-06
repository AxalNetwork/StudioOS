# Advisor pages

`AdvisorStudioHome.jsx` and `AdvisorWorkspaceShell.jsx` frame the advisor's
workspace; `advisorStudioHome.css` styles the home. `AdvisorPreviewNotice.jsx`
and `AdvisorSectionStub.jsx` explain previews and sections whose stores are
not yet available. `advisorEarnings.js` derives recorded earnings facts.

`AdvisorProfilePage.jsx` is the approved Ops A5 public profile.
`PublicAdvisorBookingPage.jsx` opens a session type's `/b/*` link and reuses
the directory booking dialog. Public responses omit account IDs and email;
booking still requires the existing authenticated role and subscription gates.

| Subfolder | Contents |
| --- | --- |
| `advisory/` | Clients, contracts and retained advisory tabs. |
| `cohorts/` | Assigned cohort guidance and outcome screens. |
| `expertise/` | The advisor's own profile, services, proof and thinking. |
| `network/` | Relationships, introductions and organisations. |
| `practice/` | Opportunities, engagements, delivery, sessions and earnings. |

Add behaviour in the mounted Worker first, reuse the approved canvas, and keep
unknown facts Not recorded and failed reads Unreadable. New routes need
regressions and desktop/phone verification; do not invent another workspace.

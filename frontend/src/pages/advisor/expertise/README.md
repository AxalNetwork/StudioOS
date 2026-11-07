# `pages/advisor/expertise` — the Expertise bucket, one file per zone

Advisor › Expertise ("Package what I know") is five zones. Each is a **body
only**: the crumb, the `h1`, the zone pills and the Worker AI rail are drawn by
`frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx`, which mounts each of
these through its `ZONE` map. The Expertise board's sections
(`frontend/src/workspaces/boards/advisorExpertise.js`) read the same routes.

| File | Zone | Route | Reads |
| --- | --- | --- | --- |
| `ProfileZone.jsx` | Public profile | `/expertise/profile` | `GET /api/advisors/me` |
| `ServicesZone.jsx` | Services & pricing | `/expertise/services` | `GET /api/advisors/me/services` (200 a page) |
| `ProofZone.jsx` | Proof | `/expertise/proof` | `GET /api/advisors/me/proof` (200 a page) |
| `ThinkingZone.jsx` | Published thinking | `/expertise/thinking` | `GET /api/advisors/me/thinking` (100 a page) |
| `VisibilityZone.jsx` | Where you appear | `/expertise/visibility` | `GET /api/advisors/me/visibility?days=30` (100 links a page; D1597) |

The modules they share:

| File | What it holds |
| --- | --- |
| `kit.jsx` | The pieces every zone draws: `ZoneBody` (loading, unreadable, empty, populated, in that order, so a failed read is never an empty store), `Unrecorded`, `NothingYet`, `StatedLimit`, `MoreRows`, the form fields and `money`. |
| `pages.js` | `usePagedList` (D4689): reads a list a page at a time, appends `next_offset` on "Show more", merges rows by key, and draws "Showing N of total" only while rows remain. A failed next page keeps the rows already read. |
| `expertiseModel.js` | What Services, Proof and Thinking say about themselves, pure (D4681): service states and edits, proof deletion lines, and each article's real state, audience and next step. |

**EVERY FIGURE IS THE WHOLE LIST (D4689).** The list routes answer one page and,
beside it, `counts` over the whole list (Visibility: `requests`). Tiles and
summaries read those, never the length or the sum of the rows on screen.
Opens are times a piece was opened here (`articles.views`), never people.

**Adding a zone:** one file here, its row in `AdvisorBucketRoutes.jsx`'s `ZONE`
map, and its row in the first table above. A list that can grow past one page
reads through `usePagedList`.

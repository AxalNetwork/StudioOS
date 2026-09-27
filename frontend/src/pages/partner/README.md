# frontend/src/pages/partner — the partner (service firm) licence's pages

The Partner Operator Canvas's pages, plus the shared kit every partner zone
imports. The bucket roots and the zone routing live in
`frontend/src/workspaces/partner/`, not here.

| Where | What it is |
| --- | --- |
| `pipeline/` | Pipeline zones: Leads, Proposals, Negotiations, Retainers, Analytics. |
| `delivery/` | Delivery zones: Board, Deliverables, Capacity, Status reports, Health (with Founder reviews, D390). |
| `offers/` | Offers zones: Catalog, Visibility, Proof, Audience fit. |
| `operations/` | The legacy `/partner/operations/*` workspace. It is retiring (D390): its two unique jobs already have canvas-built homes, and the redirects and deletion wait for the firm profile card to be mounted on Firm Settings. |
| `kit.jsx` | The one import surface for partner zones; its header lists the three traps it exists to defuse. |
| `PartnerStudioHome.jsx` | What `/studio` renders for a partner today. |
| `PartnerHomeP2.jsx` | The canvas's P2 Home, built and tested but not mounted until the owner signs it off (D394). |
| `PartnerFirmProfileCard.jsx` | The firm's partner profile, introductions switch and agreement summary, for Firm Settings (D390); mounted by that page, not by this folder. |
| `PartnerWorkspaceShell.jsx`, `PartnerWorkspaceTabs.jsx` | The legacy tabbed shell the operations workspace and a few older pages still wrap themselves in. |
| `OrganizationsZone.jsx` | Network · Organizations for this licence. |

**Adding a page.** A zone body goes in the subfolder of its bucket and
imports from `kit.jsx`. A page that is built but not yet mounted says so in
its own header and names the decision it waits on.

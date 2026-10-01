# frontend/src/pages/partner — the partner (service firm) licence's pages

The Partner Operator Canvas's pages, plus the shared kit every partner zone
imports. The bucket roots and the zone routing live in
`frontend/src/workspaces/partner/`, not here.

| Where | What it is |
| --- | --- |
| `pipeline/` | Pipeline zones: Leads, Proposals, Negotiations, Retainers, Analytics. |
| `delivery/` | Delivery zones: Board (with the engagement lifecycle and invoice ledger, D395), Deliverables, Capacity, Status reports, Health (with Founder reviews, D390). |
| `offers/` | Offers zones: Catalog, Visibility, Proof, Audience fit. |
| `kit.jsx` | The one import surface for partner zones; its header lists the three traps it exists to defuse. |
| `PartnerStudioHome.jsx` | What `/studio` renders for a partner today. |
| `PartnerHomeP2.jsx` | The canvas's P2 Home, built and tested but not mounted until the owner signs it off (D394). |
| `PartnerFirmProfileCard.jsx` | The firm's partner profile, introductions switch and agreement summary (D390), mounted on Firm Settings (`/company-settings`) for partner sign-ins (D395). |
| `PartnerWorkspaceShell.jsx`, `PartnerWorkspaceTabs.jsx` | The legacy tabbed shell a few older pages (`/needs`, `/services`, `/partner/insights` and others) still wrap themselves in. |
| `OrganizationsZone.jsx` | Network · Organizations for this licence. |

**Adding a page.** A zone body goes in the subfolder of its bucket and
imports from `kit.jsx`. A page that is built but not yet mounted says so in
its own header and names the decision it waits on.

**Retired.** `operations/` (`/partner/operations/*`) was deleted in D395. Its
six addresses redirect in `App.jsx` to the pages that took each job; do not
recreate the folder.

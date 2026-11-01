# frontend/src/pages — one component per route

Every route declared in `App.jsx` resolves to a file here. Most are lazy-loaded,
so the filename is usually the fastest way from a URL to its code: `/pricing` →
`PricingPage.jsx`.

D1180 (#3107): the old FinancialsPage is retired; the financial model is Use of
funds › Runway › Forecast (`raise/useoffunds/`), on the same `/api/financials`
store. #3128 (D1194) had already forwarded Raise Pipeline, so the Capital workspace
page is deleted: both old tabs only forward. D1029 retired the Cap Table tab. Legacy Capital links keep
the venture through `raise/captable/CapTableMovedRedirect.jsx`, which normalizes
`project` to `project_id`. The live cap table also reads both aliases through
`raise/captable/capTableModel.js` (D1029).

## Finding a page

1. Search `App.jsx` for the URL path — the `element` names the component.
2. The component name is the filename.

Naming follows the surface, not the persona: `PortfolioHealthPage`,
`SpinoutLabCapitalPage`, `PerksPage`.

## Subfolders

| Folder | What lives there |
| --- | --- |
| `incorporate/` | D1414 (#3696, INC1–INC7): Incorporate, the six-step flow that turns one of your own projects (or a new one) into a company: goals, compare, company details, review, pay & file (the catalog quote and the status timeline), done. `IncorporatePage.jsx` re-exports it. What is not on main yet comes through `incorporate/incorporateAdapter.js` (#3855's `company_uid`, #3706's Ask panel). Start at `incorporate/README.md`. |
| `team/` | D1497 (#3727): Team, the people and AI agents working on a company or a project (TM1a–TM9f), and Project settings › General. People and invitations are wired; agents, rule books and approvals come through `team/agentsAdapter.js`, the one seam #3840–#3844 swap. Start at `team/README.md`. |
| `trust/` | D1078: the member Trust Center’s requirement counts, explanations, detail sheet (D1317) and data controls at `/trust/me`. |
| `site/` | The public site's pages from the owner's website canvas (D673–D680): each renders in `SitePage` (`frontend/src/components/site/SitePage.jsx`) and draws only live data or the owner's copy. |
| `admin/` | Admin console screens and their tabs. |
| `advisor/` | The advisor's own practice surfaces. |
| `founder/` | The founder shell's workspace tab bars. |
| `investor/` | Investor-only workspace framing and visual-system styles. |

| `scoring/` | D1253 (#2428): the venture scorecard's pages — How scoring works, the founder's Investor scorecard, and HQ › Platform › Scoring. |
| `duediligence/` | D1244 (#2385): the Due diligence desk's tabs as addresses, the list's and the case's, and the model they share. |
| `articles/` | D1408 (#3694): the member's own articles, from the Article Authoring canvas (AR1–AR6) — the library, Eadwyn's writing panel, the image sheet, Publish… and the pure rules they share. `ArticleAuthorPage.jsx` mounts them at `/articles/draft` and `/articles/edit/:id`. |
| `email/` | D1344 (#3552): Email, `/email` and `/email/settings`, in every profile's shell: People, the conversation, What Eadwyn knows, the composer, connect and the sent log. |
| `deal/` | D1152: the deal page's frame for `DealRoomPage.jsx` — the key strip, the stage track and its one next action, the investor's Overview, Notes and Activity, and the states, with the pure model they share. |
| `partner/` | Partner-side operations (BD console). |
| `research/` | Research zone bodies. Library and Ask are on every licence. Funds is the founder shortlist, and `FundDossier.jsx` is one row of it at `/research/funds/:uid`. `CompanyCandidate.jsx` is one competitor at `/research/companies/:analysisId/:candidateId`. |
| `raise/` | Round-manager panels. |
| `closing/` | D1213 (#2424): the closing room (founder, investor, staff) and Contracts › Closings, from terms agreed to money in the account. |
| `referrals/` | The Refer & Earn canvas stylesheet for `ReferralsPage.jsx`. |
| `pipeline/` | Pipeline helpers shared by the pipeline screens. |
| `events/` | Public and host-side event screens. |
| `jobs/` | Public and host-side job screens. |
| `legal/` | Non-admin document origination (Send for signature). |
| `studio/` | D1419 (#3698): the Studio modularity canvas — the module grid all four `/studio` homes draw below their fixed blocks, Customise with Done as the one save, the module map, the notices, and the tile builders (`studio/tiles/`). Layouts come from the Worker's `/api/studio` through `studioLayoutApi`; Eadwyn's layout proposals wait behind `studio/studioProposalsAdapter.js` (#3864). Start at `studio/README.md`. |
| `testing/` | Product testing's owner side (D815): the programme form, the applicants panel with Pick and Decline, and the pure model they share. A partner's zone (`partner/offers/TestingZone.jsx`) and HQ's console (`admin/consoles/ProductTestingConsole.jsx`) both mount them. |
| `wellbeing/` | Wellbeing's booking flow, the expert's practice zones and the admin resource library, with the pure model they share (D570). The member home is `WellbeingPage.jsx` and the practice page is `ExpertEditorPage.jsx`, both here. |
| `subsidiary/` | A territory licence holder's read of their own licence. |
| `hq/` | The Super Admin's HQ-only surfaces: the holder console, the HQ framings of Accounts and Contracts, and the notice a plain admin sees instead. |
| `branch/` | The subsidiary shell's own pages, S1–S11, all eight rows built (D107 for why every row shipped with a route rather than only the built ones; D155 for the last of them). Start at `branch/README.md`. |
| `insights/` | Insight reader and its public variant. |
| `learning/` | The Learning center (D562): one routed page for every `/learning` route, its presentational components, and the temporary coming-soon gate. Start at `learning/README.md`. |
| `docs/` | The Help Center layout and its content sections. |
| `templates/` | `SpinoutDemoDayPage.jsx`, the public `/lp/spinout-demo-day` page. The four older persona landing pages were removed by #2321; their addresses forward to the door pages. |
| `connect/` | D668: `/connect/assistant`, where a founder approves an AI assistant (D665) for the companies they tick. Its own README holds the rules. |
| `account/` | The Account center's sections (D568), mounted by `SettingsPage.jsx`, which is still `/account`: the section list and shared kit in `AccountCenter.jsx`, one file per canvas section, and the pure helpers in `accountCenterModel.js`, `usageModel.js` and `connectorsModel.js`. Connectors (D651) replaced the Integrations page. Documented in `scripts/check-folder-docs.mjs` and in its own README. |
| `profile/` | The founder's profile pages (D702): You, Your venture, What others see and Visibility, at `/profile`, `/profile/venture`, `/profile/preview` and `/profile/visibility`, for founders only, with their shared frame and pure model. Documented in its own README. |
| `cycles/` | The four cycle overviews and their module pages (D661), drawn from #1469's shared read: the model, the SVG charts, the overview and the module page. Not mounted until each cycle's read lands. Start at `cycles/README.md`. |

## Rules

- A page fetches through `frontend/src/lib/api.js`. No `fetch()` to `/api/*` directly.
- A page that has no backend does not ship. If a canvas asks for a field the
  database does not hold, the page says the field is not recorded — it does not
  invent one. That rule is why several surfaces here carry visible "not
  recorded" copy instead of a number.
- Prefer `ui/` primitives over new one-off styling.
- Dark mode is not optional: `npm run test:drift` runs `check-dark-mode`.

## Account appearance

`SettingsPage.jsx` offers Light/Dark theme selection and explainer restoration.
Density and sidebar-start preferences are retired. The sidebar still has its
normal manual controls; the mobile drawer starts closed.

## Checkout

D755 CR7 (#1985): `CheckoutPage.jsx` buys a token pack as its own one-line order,
without mounting or clearing the shared cart. The retired top-up URL redirects
to Plans & Pricing. `CheckoutConfirmationPage.jsx` only reads the owner's order:
credit is reported only from `ai_topup.state`, with bounded backoff and cancelled
reads on navigation. Missing balance data says Unreadable; nothing is credited
from the browser. Stripe and the existing billing-country/VAT calculation stay
on the existing checkout surface.

`ProductsPage.jsx` (at `/pricing/products` since D786, #2211; `/plans-and-pricing` redirects to `/pricing` and `pricingRedirects.jsx` holds that redirect and `/pricing/investor`'s) mounts the public Token packs read after the plans on both desktop and phone; pack products are excluded from Add-ons, product details and the shared cart. The owner authorized this CR7 dependency under #1985; CR5 retains the plan-allowance and visitor-routing work.

## Investor Spin-Out Lab width

By the owner's request (2026-10-21), `SpinoutLabInvestorPage.jsx` fills the
available app column at `/spinout-lab`. Its hero background reaches both edges;
the body below has its own centered 1,240px width limit and content
padding, as clarified by the owner. Heading and paragraph line lengths stay bounded for readability.
The shell already supplies an edge-to-edge surface for this route; no other
profile's Lab page or LP workspace layout changes. This layout correction
allocates no new decision or migration number.

D1133: `PricingPage.jsx` carries the account-plan read into the checkout sheet, including loading, failure/retry and a held Pro plan.

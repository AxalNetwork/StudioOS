# frontend/src/pages — one component per route

Every route declared in `App.jsx` resolves to a file here. Most are lazy-loaded,
so the filename is usually the fastest way from a URL to its code: `/deals` →
`DealsPage.jsx`.

## Finding a page

1. Search `App.jsx` for the URL path — the `element` names the component.
2. The component name is the filename.

Naming follows the surface, not the persona: `PortfolioHealthPage`,
`SpinoutLabCapitalPage`, `PartnerDealPortal`.

## Subfolders

| Folder | What lives there |
| --- | --- |
| `site/` | The public site's pages from the owner's website canvas (D673–D680): each renders in `SitePage` (`frontend/src/components/site/SitePage.jsx`) and draws only live data or the owner's copy. |
| `admin/` | Admin console screens and their tabs. |
| `advisor/` | The advisor's own practice surfaces. |
| `founder/` | The founder shell's workspace tab bars. |
| `investor/` | Investor-only workspace framing and visual-system styles. |
| `partner/` | Partner-side operations (BD console). |
| `research/` | Research zone bodies. Library and Ask are on every licence. Funds is the founder shortlist, and `FundDossier.jsx` is one row of it at `/research/funds/:uid`. `CompanyCandidate.jsx` is one competitor at `/research/companies/:analysisId/:candidateId`. |
| `captable/` | Cap-table panels composed into `CapTablePage.jsx`. |
| `raise/` | Round-manager panels. |
| `referrals/` | The Refer & Earn canvas stylesheet for `ReferralsPage.jsx`. |
| `pipeline/` | Pipeline helpers shared by the pipeline screens. |
| `events/` | Public and host-side event screens. |
| `jobs/` | Public and host-side job screens. |
| `legal/` | Non-admin document origination (Send for signature). |
| `wellbeing/` | Wellbeing's booking flow, the expert's practice zones and the admin resource library, with the pure model they share (D570). The member home is `WellbeingPage.jsx` and the practice page is `ExpertEditorPage.jsx`, both here. |
| `subsidiary/` | A territory licence holder's read of their own licence. |
| `hq/` | The Super Admin's HQ-only surfaces: the holder console, the HQ framings of Accounts and Contracts, and the notice a plain admin sees instead. |
| `branch/` | The subsidiary shell's own pages, S1–S11, all eight rows built (D107 for why every row shipped with a route rather than only the built ones; D155 for the last of them). Start at `branch/README.md`. |
| `insights/` | Insight reader and its public variant. |
| `learning/` | The Learning center (D562): one routed page for every `/learning` route, its presentational components, and the temporary coming-soon gate. Start at `learning/README.md`. |
| `docs/` | The Help Center layout and its content sections. |
| `templates/` | Persona home-page templates. |
| `connect/` | D668: `/connect/assistant`, where a founder approves an AI assistant (D665) for the companies they tick. Its own README holds the rules. |
| `account/` | The Account center's sections (D568), mounted by `SettingsPage.jsx`, which is still `/account`: the section list and shared kit in `AccountCenter.jsx`, one file per canvas section, and the pure helpers in `accountCenterModel.js`, `usageModel.js` and `connectorsModel.js`. Connectors (D651) replaced the Integrations page. Documented in `scripts/check-folder-docs.mjs` and in its own README. |
| `cycles/` | The four cycle overviews and their module pages (D661), drawn from #1469's shared read: the model, the SVG charts, the overview and the module page. Not mounted until each cycle's read lands. Start at `cycles/README.md`. |

## Rules

- A page fetches through `frontend/src/lib/api.js`. No `fetch()` to `/api/*` directly.
- A page that has no backend does not ship. If a canvas asks for a field the
  database does not hold, the page says the field is not recorded — it does not
  invent one. That rule is why several surfaces here carry visible "not
  recorded" copy instead of a number.
- Prefer `ui/` primitives over new one-off styling.
- Dark mode is not optional: `npm run test:drift` runs `check-dark-mode`.

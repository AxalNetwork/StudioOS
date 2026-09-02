# frontend/src/pages — one component per route

Every route declared in `App.jsx` resolves to a file here. Most are lazy-loaded,
so the filename is usually the fastest way from a URL to its code: `/deals` →
`DealsPage.jsx`.

## Finding a page

1. Search `App.jsx` for the URL path — the `element` names the component.
2. The component name is the filename.

Naming follows the surface, not the persona: `PortfolioHealthPage`,
`SpinoutLabCapitalPage`, `PartnerPortal`.

## Subfolders

| Folder | What lives there |
| --- | --- |
| `admin/` | Admin console screens and their tabs. |
| `advisor/` | The advisor's own practice surfaces. |
| `founder/` | The founder shell's workspace tab bars. |
| `investor/` | Investor-only workspace framing and visual-system styles. |
| `partner/` | Partner-side operations (BD console). |
| `captable/` | Cap-table panels composed into `CapTablePage.jsx`. |
| `raise/` | Round-manager panels. |
| `referrals/` | The Refer & Earn canvas stylesheet for `ReferralsPage.jsx`. |
| `pipeline/` | Pipeline helpers shared by the pipeline screens. |
| `events/` | Public and host-side event screens. |
| `jobs/` | Public and host-side job screens. |
| `legal/` | Non-admin document origination (Send for signature). |
| `subsidiary/` | A territory licence holder's read of their own licence. |
| `insights/` | Insight reader and its public variant. |
| `docs/` | The Help Center layout and its content sections. |
| `templates/` | Persona home-page templates. |

## Rules

- A page fetches through `frontend/src/lib/api.js`. No `fetch()` to `/api/*` directly.
- A page that has no backend does not ship. If a canvas asks for a field the
  database does not hold, the page says the field is not recorded — it does not
  invent one. That rule is why several surfaces here carry visible "not
  recorded" copy instead of a number.
- Prefer `ui/` primitives over new one-off styling.
- Dark mode is not optional: `npm run test:drift` runs `check-dark-mode`.

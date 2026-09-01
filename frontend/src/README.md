# frontend/src — the Axal VC SPA

React + Vite. `npm run build` compiles this tree into `docs/`, which the
Cloudflare Worker serves through its `[assets]` binding. **`docs/` is build
output — never edit it by hand.**

`App.jsx` is the router: every route in the product is declared there, wrapped
in a role guard. `sidebarConfig.js` decides what each persona sees in the nav.
Those two files together are the fastest way to answer "where does this URL go".

## Subtrees

| Folder | What lives there |
| --- | --- |
| `pages/` | One component per route. The biggest folder in the repo — read its README first. |
| `workspaces/` | The four canvas shells. `shellConfig.js` is the IA — eight rows per role, each bucket a list of zones — and `WorkspaceShell`/`ZoneNav` render from it, so a row can never advertise a door the router does not open. Per-role route modules live in `founder/`, `investor/`, `advisor/`, `partner/`. |
| `components/` | Shared presentational pieces, grouped by the feature that owns them. |
| `ui/` | The design-system primitives (`Card`, `Pill`, `Stat`, `SidebarNav`, `AssistRail`). New UI composes these rather than re-styling from scratch. |
| `lib/` | Non-visual browser code: the API client, formatters, search. |
| `hooks/` | Shared React state (`useAuthSync`, `useSpinoutLabState`, …). |
| `contexts/` | React context providers, including active-company context. |
| `data/` | Static reference data — **not** a place for fake records. |
| `decks/` | The pitch-deck renderer and its slide templates. |
| `templates/` | Persona landing-page templates. |
| `brand/` | Brand-builder template content. |

## Rules

- **Company context changes in one place.** `ui/CompanySwitcher.jsx` owns it;
  pages read it from context. A page that sets company context itself is a bug.
- **No page shows more than one company's data.**
- **Never add a method to `lib/api.js` without a matching worker route.**
  `npm run test:drift` fails the build otherwise.
- **Money is integer cents.** A float parsed out of a money field fails CI.
- **Absent data reads as absent** — "Not recorded", never an invented zero or a
  plausible-looking placeholder.

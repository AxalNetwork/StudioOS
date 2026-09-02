# frontend/src/ui — design-system primitives

The small set of components everything else is built from. If you are about to
write a bordered white box with a title, it already exists here.

| File | What it is |
| --- | --- |
| `Card.jsx` | The standard panel. |
| `Pill.jsx` | Status and tag chips. |
| `Stat.jsx` | A labelled figure. |
| `SectionLabel.jsx` | The small uppercase section heading. |
| `SidebarNav.jsx` | The app sidebar, lifted out of `App.jsx`. |
| `CompanySwitcher.jsx` | **The only place active-company context changes.** |
| `AssistRail.jsx` | The single AI rail that replaced eight separate ones. |
| `AssistLayout.jsx` | Page shell that hosts the rail. |
| `WorkerRail.jsx` | The Worker AI rail every licence shares — six founder workspaces and the investor shell's twenty-four surfaces. It replaced thirty-nine local rail functions re-declared at the bottom of individual page files. `role` picks the accent from `workspaces/shellConfig`'s `ACCENT`. |
| `workerRail.css` | Styles for `WorkerRail`, scoped to `.fwr`. |
| `assistCost.js` | Spend accounting for the rail. |
| `eadwynConfig.js` | Naming and copy for the assistant. |
| `index.js` | The public entry point — import from here. |

## Rules

- **Import from `index.js`**, not from the individual files.
- The assistant is called **Eadwyn**. Its copy must avoid regulated wording —
  "advisor", "advice", "recommendation", "fiduciary" are lint-enforced out of
  AI naming and surfaces.
- Every primitive supports dark mode. A new one that does not will fail
  `check-dark-mode`.

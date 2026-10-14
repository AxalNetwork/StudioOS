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
| `AssistRail.jsx` | The older per-feature AI rail, still on the Spin-Out Lab pages and a few founder tools (Advisory, Brand builder, Deck reviewer). New pages mount `WorkerRail`. |
| `AssistLayout.jsx` | Page shell that hosts the rail. |
| `WorkerRail.jsx` | The Worker AI rail every licence shares — founder, investor, advisor, partner and both admin tiers, mounted on about ninety pages. It draws the AIRail canvas (`design/incoming/AIRail.dc.html`) and nothing else (owner, 2026-10-10): the mode cards, "Model · this page", the Usage card and the safety row. `role` picks the accent from `workspaces/shellConfig`'s `ACCENT`. |
| `railModels.js` | The editorial half of the rail's model cards: each model's display name, sentence and tags, and each section's jobs (`SECTION_JOBS`), the router tasks its pages run. Which models exist, their rates and which one is the default all come from `/api/ai/pricing`. |
| `railModelChoice.js` | The rail's model pick, stored per section and per task. The rail writes it, and the bands that run the task (`../workspaces/FillProposals.jsx`) read it. |
| `railInheritance.js` | Whether a page is a workspace root (the rail offers the model menu) or a zone under one (the rail shows the workspace's model as inherited), worked out from role and URL (D402). |
| `BrandIcon.jsx` | D687: every service's mark, coded once — Simple Icons 16.35.0 paths (CC0) in `BRAND_MARKS`, lucide glyphs for non-brands in `BRAND_GENERIC`, and the initials tile on purpose, with its reason, in `BRAND_MONOGRAM`. Look up by key only (`resolveBrand`); a mark sits beside a visible name and is never the only label. The table of sources is `documentation/architecture/decisions/D687.md`. |
| `Honesty.jsx` | `Unrecorded` (the store holds no value) and `Unreadable` (the read failed, with a retry). |
| `EadwynComposer.jsx` | D652: the "Ask Eadwyn" composer. **Not mounted** (owner, 2026-10-10): the Worker AI rail is the AIRail canvas, which has no chat, so it waits for a canvas that places it. A stored conversation, its "+" menu ("Add a file", "Connectors ›" with a switch per connection), answers with their source line, and the Send/Cancel card for a write Eadwyn proposed. |
| `RailFrame.jsx` | The one frame a `WorkerRail` sits in (D556): docked right, full height, seam, ground and inset, collapsing through `--fwr-track`. Every host that does not draw the founder desks' frame in its own stylesheet passes its rail here; `WorkspaceShell` does too. |
| `workerRail.css` | Styles for `WorkerRail`, scoped to `.fwr`, and for `RailFrame`, scoped to `.fwr-frame`. |
| `assistCost.js` | Spend accounting for the rail. |
| `eadwynConfig.js` | Naming and copy for the assistant. |
| `index.js` | The public entry point — import from here. |

## Rules

- **Import from `index.js`**, not from the individual files.
- The assistant is called **Eadwyn**. Its copy must avoid regulated wording —
  "advisor", "advice", "recommendation", "fiduciary" are lint-enforced out of
  AI naming and surfaces.
- Every primitive supports dark mode. `check-dark-mode` scans `pages/` and
  `components/` only, not this folder, so each primitive's own test asserts its
  `dark:` classes (`ActionSheet` and `Lightbox` do).

`Lightbox.jsx` (D685) is the one lightbox shell: a centred dialog, a full-screen sheet on a phone, with a focus trap, Escape and backdrop close, focus returned to what opened it, an inert background and no scroll bleed. `lightboxFocus.js` holds its rules as pure functions. Record a session is its first user; Build's, Raise's and Grow's cycle CTAs reuse it. D686 (#1596) gives it `size="tall"` (a fixed height whose child owns the scroll) and `onEscape`; one Escape closes one layer, because `../components/useEscapeClose.js` shares its stack. `ActionSheet.jsx` (D686) is the body every cycle lightbox draws inside a tall `Lightbox`: Cycle Action's header (eyebrow, an h2 title, sub, a round ×), step pills with `aria-current`, a banner, a body that scrolls on its own, and a footer with a note and actions, plus the shared `primary`, `ghost` and `danger` button classes.

# frontend/src/ui — design-system primitives

The small set of components everything else is built from. If you are about to
write a bordered white box with a title, it already exists here.

| File | What it is |
| --- | --- |
| `Card.jsx` | The standard panel. |
| `Pill.jsx` | Status and tag chips. |
| `Stat.jsx` | A labelled figure. |
| `SectionLabel.jsx` | The small uppercase section heading. |
| `SidebarNav.jsx` | The app sidebar, lifted out of `App.jsx`. Its pinned footer is Companies and projects, at `/account/companies` (D1140; it was Company Settings). |
| `CompanySwitcher.jsx` | **The only place active-company context changes.** Its menu ends with "Manage companies and projects ›", to `/account/companies` (D1140, CMP19a). |
| `phone/` | D699 phone bars, rows, sheets and one width hook; see its README. |
| `AssistRail.jsx` | The older per-feature AI rail, still on the Spin-Out Lab pages and a few founder tools (Advisory, Brand builder, Deck reviewer). New pages mount `WorkerRail`. |
| `AssistLayout.jsx` | Page shell that hosts the rail. |
| `AskButton.jsx` | D1604 (#3716): the one Eadwyn "Ask" button, lifted from Team's D1497 `AskButtonView` (`frontend/src/pages/team/AskButton.jsx` re-exports it). It reads "Ask", its accessible name "Ask Eadwyn", with ", N waiting" only for a counted N > 0, and pd40's running, AI-off, unreadable and out-of-tokens states; a sub-line describes it. It runs nothing: its host decides what it opens (the Pitch deck studio's `DeckAsk`; the profile zone headers' `frontend/src/workspaces/ProfileHeaderAsk.jsx`, D1424, gated off until #3706's panel). |
| `WorkerRail.jsx` | The Eadwyn AI rail every licence shares — founder, investor, advisor, partner and both admin tiers, mounted on about ninety pages. It draws the AIRail canvas (`design/canvases/integrated/AIRail.dc.html`, the "AIRail · every page" export since D769): "Eadwyn AI", the viewer's licence pill and the crumbs, "Turn off AI assistance on this page" on every page (on by default), "Suggested for this page" and "On this page" from the page's or the open option's row of the Worker's matrix (`GET /api/ai/rail`), "All models", the guard sentence and the Usage box over `/api/ai-budget/me` with Add tokens. No id, estimate or receipt. `role` picks the accent from `workspaces/shellConfig`'s `ACCENT`; the pill is the viewer's `shellRole`. On a phone a founder on a founder page gets `EadwynPanel`, every other viewer D405's floating button and sheet. D1604 (#3716): an optional `groups` prop draws "Suggested for this page" as one block per element group (`RailGroups.jsx`); without it nothing changes. |
| `RailGroups.jsx` | D1604 (#3716, aird1): `WorkerRail`'s element groups for a host that passes `groups` (the pitch pages): the presets row, one block per group (its lead option's suggested models, read when opened, at most three, a pick stored for every option of the group), "Not set up yet" groups, Safety always on, and extra usage rows drawn only when their read answers. Models and consumption only: nothing here runs a model or takes words. |
| `railModels.js` | Each router model's name (`MODEL_COPY`), the "AIRail · every page" canvas's ten All models groups with each name's router id (`ALL_MODELS`) and New list (`NEW_MODELS`), and `railView`, which shapes `GET /api/ai/rail`'s answer into the rail's cards, options and All models rows. Which models a page runs is the Worker's matrix, not a table here (D769 PR 2). No figure: the copy table prices nothing. |
| `railPrices.js` | D769 (#2088): the price beside each model on the rail, a card's from `GET /api/ai/rail` (`railModelPrice`) and an All models row's from the rate card (`GET /api/ai/rates`), billed only once the Worker says `billing: 'billed'`, printed in the canvas's units (`priceText`), never multiplied here; "Not available" for no price, "Unreadable" for a failed read; the guard sentence (`guardSentence`) and the All models note. |
| `railModelChoice.js` | The rail's model pick, stored per section and per task, on the Worker (`ai_rail_preferences`, migration 465) with this browser as the cache: `syncRailPrefs` reads it once per page load. The rail writes it, and the bands that run the task (`../workspaces/FillProposals.jsx`) read it synchronously. |
| `railCrumbs.js` | D698: the rail's crumbs, "section › module › record". `RailCrumbsProvider` (mounted by `../pages/cycles/CycleRoute.jsx`), `useRailCrumbs`, and `useSetRailCrumbs`, which a record view calls with its title. |
| `eadwynPanel.js` | D698: the phone panel's store. `openEadwynPanel(label)`, `closeEadwynPanel`, `useEadwynPanel()` (`open`, `label`, `available`), and `useEadwynTrigger`, which a page's own Eadwyn button calls. It serves a founder viewer of a founder rail and no one else. |
| `EadwynPanel.jsx` | D698: the panel itself (CO:30-36), a 300px right dialog over a scrim that `WorkerRail` portals to `<body>`, and `EadwynButton`, the 40px button a page draws to open it. |
| `BrandIcon.jsx` | D687: every service's mark, coded once — Simple Icons 16.35.0 paths (CC0) in `BRAND_MARKS`, lucide glyphs for non-brands in `BRAND_GENERIC`, and the initials tile on purpose, with its reason, in `BRAND_MONOGRAM`. Look up by key only (`resolveBrand`); a mark sits beside a visible name and is never the only label. The table of sources is `documentation/architecture/decisions/D687.md`. |
| `VerifiedBadge.jsx` | D753 decision 7: the one "Verified" mark, a scalloped check (lucide `badge-check`, inlined) whose `<title>` names the day a live connect on production passed. It draws only with a recorded `verified_on` date, so a claim with no record shows nothing. The connector cards and the connector page header both use it. |
| `Charts.jsx` | D893's charts as plain SVG, moved here from `pages/admin/insights/` by D929 (#2725): horizontal bars, columns (the current week hatched, stacked, or grouped by series with each series hatched in its own colour), absolute stacked bars whose segments open a list, the weekly line and the multi-series weekly line (a dash names a series; the current week is only a hollow point), the 100% bar and the donut, their `Legend` and "View as table" (`ChartTable`). One palette (violet, sky, amber, emerald, muted); only violet changes in dark mode (D915 §6). Admin › Insights, Admin › Community, Events Overview (D920) and Partner invitations draw with it. Horizontal bars accept an optional fixed maximum and reference line for comparable percentages. D994: grouped columns draw a value not recorded (`null`) as a dashed baseline mark, never a zero bar. |
| `Honesty.jsx` | `Unrecorded` (the store holds no value) and `Unreadable` (the read failed, with a retry). |
| `parseStamp.js` | D923 (#2370): a stored time as epoch milliseconds. D1's zone-less `CURRENT_TIMESTAMP` stamps are read as UTC, an ISO stamp with its own zone as written. Written for the Events desk (D915); the Events desk and Partner invitations both read it. A pure model imports this file directly, not the barrel, so it stays free of React. |
| `AdminPageHeader.jsx` | D936 (#2375): the one admin page header — breadcrumb (a back link on a phone), title with its pills and actions, line, facts, the HQ-held scope chip, the moved notice (`useMovedNotice`) and the tab bar of literal `HeaderTab` links, each count a number, a dash with its reason, an amber "waiting" dot or a loading bar, never 0 for a missing value. It replaces the Admin Console's title and dropdown; the Spin-Out Lab (D937) is its first page. D1122 completes the phone action row, tab fade, and More bottom sheet with focus containment; Billing uses its HQ-only pill. D938 added the More menu (`more`, of `HeaderMenuItem` links and actions; SHL1) and a `chip` slot for a page whose scope chip says something else (Insights). |
| `EadwynComposer.jsx` | D652: the "Ask Eadwyn" composer. **Not mounted** (owner, 2026-10-10): the Eadwyn AI rail is the AIRail canvas, which has no chat, so it waits for a canvas that places it. A stored conversation, its "+" menu ("Add a file", "Connectors ›" with a switch per connection), answers with their source line, and the Send/Cancel card for a write Eadwyn proposed. |
| `RailFrame.jsx` | The one frame a `WorkerRail` sits in (D556): docked right, full height, seam, ground and inset, collapsing through `--fwr-track`. Every host that does not draw the founder desks' frame in its own stylesheet passes its rail here; `WorkspaceShell` does too. |
| `workerRail.css` | Styles for `WorkerRail`, scoped to `.fwr`, for `RailFrame`, scoped to `.fwr-frame`, and for `EadwynPanel`, scoped to `.ead-panel` and `.ead-open`. Every colour rule D698 added has its `.dark` pair. |
| `assistCost.js` | Spend accounting for the rail. |
| `eadwynConfig.js` | Naming and copy for the assistant. |
| `index.js` | The public entry point — import from here. |
| `linkedinBrand.js` | D1355: official LinkedIn asset provenance, hashes, approved theme variants and minimum dimensions. |
| `LinkedInSignInButton.jsx` | D1355: unmodified official sign-in artwork at actual LinkedIn OAuth entry points. |

## Rules

- **Import from `index.js`**, not from the individual files.
- The assistant is called **Eadwyn**. Its copy must avoid regulated wording —
  "advisor", "advice", "recommendation", "fiduciary" are lint-enforced out of
  AI naming and surfaces.
- Every primitive supports dark mode. `check-dark-mode` scans `pages/` and
  `components/` only, not this folder, so each primitive's own test asserts its
  `dark:` classes (`ActionSheet` and `Lightbox` do).

`Lightbox.jsx` (D685) is the one lightbox shell: a centred dialog, a full-screen sheet on a phone, with a focus trap, Escape and backdrop close, focus returned to what opened it, an inert background and no scroll bleed. `lightboxFocus.js` holds its rules as pure functions. Record a session is its first user; Build's, Raise's and Grow's cycle CTAs reuse it. D686 (#1596) gives it `size="tall"` (a fixed height whose child owns the scroll) and `onEscape`; one Escape closes one layer, because `../components/useEscapeClose.js` shares its stack. D695 (#1656) adds opt-in `pageBelow="lg"`: below 1024px it is a normal-flow page with a back bar (or supplied `bar`), without a backdrop, focus trap, inert background or scroll lock; header/footer padding follows the canvas at 18px/14px vertically. `ActionSheet.jsx` (D686) is the body every cycle lightbox draws inside a tall `Lightbox`: Cycle Action's header (eyebrow, an h2 title, sub, a round ×), step pills with `aria-current`, a banner, a body that scrolls on its own, and a footer with a note and actions, plus the shared `primary`, `ghost` and `danger` button classes. D703 (#1665) adds page mode's bar and frame: `bar` may be a function of `{ title, sub, onBack }` (`onBack` is `onEscape` when set, else `onClose`); with no `bar`, a page takes one from `LightboxBarProvider`; `pageClass` classes the page's root; `useLightboxPage()` is true inside a page and false inside a dialog; and inside a page `ActionSheet` draws no header row, keeps its sub as its first line and flows with the page. D1014 (#2833) adds opt-in `phone="sheet"`: on a phone the dialog is a bottom sheet (pinned to the bottom, as tall as its content up to 92% of the viewport, rounded on top) instead of full screen; Payments' dialogs use it.

## Connector artwork follow-up (#1682)

`BrandIcon.jsx` now also records seven vendor SVG artworks, including the
Google gradients and the Microsoft identity symbol. Source view boxes and
multi-colour palettes are preserved, with a white backing in dark mode.
React `useId` scopes gradient, filter and clip-path references per icon.
Mercury now uses its official connector SVG and DocuSign its official embedded
favicon; both are pinned to vendor repositories (D687 follow-up).
The remaining Carta, legacy Affinity CRM and Teams initials each carry a
specific reason; see the 2026-10-16 follow-up in D687 for the current inventory.

Carta's connector mark uses its official plugin icon, pinned and embedded as
an unmodified PNG in `BrandIcon.jsx` (D687). Its source Apache-2.0 licence is
included there; no logo host request is made.

D1081: Lovable uses the existing initials tile, explicitly classified in `BRAND_MONOGRAM`; no vendor artwork or remote logo is added.

`CoverDrawPress.jsx` (#3935, D1478 task 1) is the "Draw a cover" press beside a cover-image field: Price it (one figure for the draw and its three checks, and the model that will draw), then Draw. A drawn cover fills the field through `onDrawn(url, alt)`; the page's own Save writes it. `coverDraw.js` holds its actions as plain functions. The event editor and the course builder use it.

`Sheet.jsx` (D1317) is the one detail sheet: every record's detail panel opens there, on the right, full height, docked beside the Eadwyn rail. While a sheet is open the rail draws its 44px spine (`sheetStore.js`), undimmed and clickable, and the spine's button closes the sheet before it opens the rail. With no rail the sheet meets the window's edge. It keeps the panel's own width (480 to 760px, capped at `calc(100vw - 108px)`), fixes its header and footer and scrolls its body, and keeps `Lightbox`'s modal contract (focus trap, Escape on the shared stack, focus returned, inert background except `[data-sheet-keep]`). `sheet.css` holds the dock, the 200ms slide and the phone forms. Confirmations, step-up dialogs and lightbox pickers stay `Lightbox`.

`FillMark.jsx` and `FillSheet.jsx` (D1327, #3488) are Ask's one mark and one sheet, for every profile. `FillMark` draws the glyph, the 20px field trigger ("Ask Eadwyn to fill [field]", drawn only where `GET /api/fills/sheet` says `trigger`, never on a typed, never-fill or decision field and never for a reader), the form's "Ask" and the module's "Ask" with its waiting count, and the provenance pill ("Eadwyn", "Eadwyn · edited", "Eadwyn · sourced", "Connector · Mercury · 12 Oct", "Recorded · From Validate", "Not saved", a reader's "Typed", "Unreadable"), whose card carries Undo behind a dialog. `FillSheet` is `Sheet` at 520px: Sources, then a Preview table, with Running, Partial, Refused, Out of tokens, Empty and Error. It writes nothing: Accept hands values to the form, whose Save writes. Their words are `../lib/fillSheet.js`. No model name or option key is drawn.

`useScopedFill.jsx` (D1329, #3490) mounts them on a record that is not a venture's (an IC memo, an advisor's service, a status report, an event and its agenda, a publication): `useScopedFill` reads the sheet by `record` or `parent`, never `project`, and records the fill after the page's own Save; `FillLabel` draws a field's trigger, "Not saved" and mark; `FillFormBar` draws the form's Ask, the off line and "Not filled here". Its words are `../lib/fillScoped.js`.

D1165: `LightboxPhoneProvider` scopes the phone form to a page. Fund admin
uses `phone="sheet"` for its nested drawers, including reused connection
sheets. An explicit `phone` on a Lightbox wins; other pages keep `full`.

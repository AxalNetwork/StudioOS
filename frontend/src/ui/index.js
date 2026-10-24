/**
 * frontend/src/ui — the shared component layer for the Axal design system.
 *
 * One import surface: `import { Card, Pill, Stat } from '../ui'`.
 *
 * Two kinds of thing live behind this barrel.
 *
 * 1. Primitives authored here, from the pattern census in design/
 *    (design/pattern-census.md). Each was counted across the 107 design
 *    canvases before it was written — the counts are in each file's header,
 *    and they are the argument for the component existing at all.
 *
 * 2. Four components that already existed and were already good:
 *    EmptyState, ErrorState, Skeleton and InfoStrip. They are re-exported
 *    from components/, NOT moved. The census found their problem is adoption
 *    (3-4 importers each) rather than design, and relocating files would mean
 *    rewriting import sites across the app to fix nothing. Re-exporting gives
 *    new code one place to import from while leaving every existing caller
 *    untouched. If they are ever physically moved, this barrel keeps the
 *    public path stable through the move.
 *
 * Tokens come from the @theme block in src/index.css, derived from
 * design/tokens/tokens.json. Use the utilities (bg-axal-violet,
 * rounded-axal-lg, tracking-axal-label) — Tailwind v4 tree-shakes any theme
 * token no utility references, so a raw var() in an inline style will
 * silently resolve to nothing.
 */

// Primitives — authored for the design system.
export { default as SectionLabel } from './SectionLabel';
export { default as Card } from './Card';
export { default as Pill, PILL_TONES } from './Pill';
export { default as Stat, Stat as StatTile, StatGrid } from './Stat';
// D685 — the one lightbox shell: a centred dialog, a full-screen sheet on a phone. See Lightbox.jsx.
export { default as Lightbox, LightboxBarProvider, useLightboxPage } from './Lightbox';
// D686 — Cycle Action's lightbox body: header, step pills, banner, scrolling body, footer; shared button classes. See ActionSheet.jsx.
// D687 — every service's mark, coded once (Simple Icons 16.35.0, CC0), with initials where no mark is cleared. See BrandIcon.jsx.
export { default as BrandIcon, BRAND_MARKS, BRAND_GENERIC, BRAND_MONOGRAM, BRAND_ALIAS, resolveBrand, TILE_HEX } from './BrandIcon';
// D753 — the one Verified mark, drawn only with a recorded check date. See VerifiedBadge.jsx.
export { default as VerifiedBadge, verifiedDay } from './VerifiedBadge';
export { default as ActionSheet, primary as actionPrimary, ghost as actionGhost, danger as actionDanger } from './ActionSheet';

// The AI control rail — eight canvases, one component. Not navigation: see
// documentation/architecture/DECISIONS.md T3. The gateway it reports on is services/aiRouter.ts and has
// existed all along; the spend meter has a live source (api.myAiSpend). Mode
// persistence exists (hooks/useAssistMode, D45) and WorkerRail offers the
// router's own model menu per workspace (D13's condition, met); AssistRail's
// header says which of its props are still props and why.
export { default as AssistRail } from './AssistRail';
// The one place that knows how the rail sits beside a page — see D15 for
// which surfaces get it and why onboarding does not.
export { default as AssistLayout } from './AssistLayout';
// The workspace rail, shared by every licence. Separate from AssistRail because
// it reports one shared surface — every zone runs the same `workspace_explain`
// task over the Coverage lines it is already showing — where AssistRail is
// configured per feature. It named no model at all until that route existed;
// see WorkerRail.jsx for why the route had to come first.
export { default as WorkerRail } from './WorkerRail';
// D556 — the one frame every host that does not draw the founder desks' own
// panel puts its rail in. See RailFrame.jsx.
export { default as RailFrame, RailStripSlot } from './RailFrame';
// D698 — the rail's phone panel and the page's own button that opens it
// (EadwynPanel.jsx, over the eadwynPanel.js store), and the crumbs a page
// passes the rail (railCrumbs.js).
export { EadwynPanel, EadwynButton } from './EadwynPanel.jsx';
export { openEadwynPanel, closeEadwynPanel, useEadwynPanel, useEadwynTrigger } from './eadwynPanel.js';
export { RailCrumbsProvider, useRailCrumbs, useSetRailCrumbs } from './railCrumbs.js';
export { RailPageProvider, useRailOption, useRailPage } from './railCrumbs.js';
export { formatCost, formatSpend, runCost, batchCost, spendMeter } from './assistCost';
export { eadwynConfig, observedRunCost, ASSIST_SURFACES, EADWYN_GUARDRAIL } from './eadwynConfig';

// The left navigation, lifted out of App.jsx unchanged (census: lift, do not
// rebuild — the live one already beats the canvas rail), and the company
// switcher that rides above it — the single writer of active-company context.
export { default as SidebarNav } from './SidebarNav';
export { default as CompanySwitcher } from './CompanySwitcher';
export { PhoneSheet, SheetRow } from './phone/PhoneSheet';
export { PhoneRows } from './phone/PhoneRows';
export { PhoneBar, backFallback } from './phone/PhoneBar';
export { CompanySheet, CompanyVisits, visitToRecord } from './phone/CompanySheet';
export { AccountSheet } from './phone/AccountSheet';
export { usePhoneWidth } from './phone/usePhoneWidth';
export { PhoneHeader, HeaderForWidth } from './phone/PhoneHeader';

// The two ways a page says it does not know something. One pair, because
// four copies had already drifted apart in their wording — see Honesty.jsx.
export { Unrecorded, Unreadable } from './Honesty';
// The same rule one layer down, for the cases that need a STRING rather than
// an element — inside a `title=`, a template literal, an export column. They
// had drifted the same way and further: `text` was declared 19 times in two
// behaviours, and a title-caser 30 times under 14 names, one of which re-cased
// its own fallback sentence into "Stage Not Recorded". See lib/absence.js.
export { NOT_RECORDED, text, titleCase } from '../lib/absence';
// D923 (#2370): a stored time read by one rule, D1's zone-less stamps as UTC.
// A pure model imports `./parseStamp.js` itself, so it stays free of React.
export { parseStamp } from './parseStamp.js';
// D893's charts, moved here from pages/admin/insights/ by D929 (#2725) so every
// admin desk draws the same parts in the one palette (D915 §6). See Charts.jsx.
export {
  Bar100, Chart, ChartTable, Columns, Donut, GroupedColumns, HBars, Legend, StackBars, WeekLine, WeekLines, useBoxWidth,
} from './Charts';
// D936 (#2375): the one admin page header — crumb, title, line, scope chip,
// moved notice and tab bar — that replaces the Admin Console's title and dropdown.
export { default as AdminPageHeader, HeaderTab, HeaderMenuItem, useMovedNotice, HELD_SCOPE_LABEL, HELD_SCOPE_TITLE } from './AdminPageHeader';

// Pre-existing, re-exported so `ui/` is the one import surface.
export { default as EmptyState } from '../components/EmptyState';
export { default as ErrorState } from '../components/ErrorState';
export { default as Skeleton } from '../components/Skeleton';
export { default as InfoStrip } from '../components/InfoStrip';

export { AiBudgetUsage, LiveAiBudgetUsage } from './AiBudgetUsage';

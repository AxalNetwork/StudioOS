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

// The AI control rail — eight canvases, one component. Not navigation: see
// documentation/architecture/DECISIONS.md T3. The gateway it reports on is services/aiRouter.ts and has
// existed all along; the spend meter now has a live source (api.myAiSpend).
// Mode persistence and a user-selectable model do not exist yet — AssistRail's
// header says exactly which of its props are still props and why.
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
export { formatCost, formatSpend, runCost, batchCost, spendMeter } from './assistCost';
export { eadwynConfig, observedRunCost, ASSIST_SURFACES, EADWYN_GUARDRAIL } from './eadwynConfig';

// The left navigation, lifted out of App.jsx unchanged (census: lift, do not
// rebuild — the live one already beats the canvas rail), and the company
// switcher that rides above it — the single writer of active-company context.
export { default as SidebarNav } from './SidebarNav';
export { default as CompanySwitcher } from './CompanySwitcher';

// Pre-existing, re-exported so `ui/` is the one import surface.
export { default as EmptyState } from '../components/EmptyState';
export { default as ErrorState } from '../components/ErrorState';
export { default as Skeleton } from '../components/Skeleton';
export { default as InfoStrip } from '../components/InfoStrip';

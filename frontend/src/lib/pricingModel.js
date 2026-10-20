/**
 * D786 (#2211) — the data layer for /pricing's five tabs (D785 D-a, D-b):
 * Founder, Investor, Advisors, Operating Partners and Models.
 *
 * Pure but for `useLandingTab`. The role tabs read the public plans
 * (`GET /api/public/plans-and-packs`, the catalogue mirror a visitor may read;
 * `/api/catalog` needs sign-in) and keep the plans of their family. A role
 * the catalogue sells no plan says so (`{ none: true }`) and never shows an
 * invented one (D783: top up AI tokens as you go). The Models tab reads
 * `GET /api/public/ai/models`. Part 2 draws both to the "Pricing" canvas.
 */
import { useViewMode } from '../contexts/ViewModeContext';

/** The switch's tabs, in the canvas's order: `key` is `?for=`, `family` the plans' family (`aiCredits.planOf`). */
export const PRICING_TABS = Object.freeze([
  { key: 'founder', label: 'Founder', family: 'founder' },
  { key: 'investor', label: 'Investor', family: 'investor' },
  { key: 'advisor', label: 'Advisors', family: 'advisor' },
  { key: 'operating-partner', label: 'Operating Partners', family: 'partner' },
  { key: 'models', label: 'Models', family: null },
]);
const KEYS = new Set(PRICING_TABS.map((t) => t.key));

/** What a role with no plan reads (D783). */
export const NO_PLAN_LINE = 'No plan: top up AI tokens as you go';

/** `?for=` when it names a tab, else null. */
export function tabFromSearch(search) {
  const value = new URLSearchParams(String(search || '')).get('for');
  return value && KEYS.has(value) ? value : null;
}

/** The tab a role lands on: its own, an Operating Partner's for `partner`; anyone else, and a visitor, on Founder. */
export function landingTab(shellRole) {
  if (shellRole === 'investor') return 'investor';
  if (shellRole === 'advisor') return 'advisor';
  if (shellRole === 'partner') return 'operating-partner';
  return 'founder';
}

/** `?for=` first, else the role's landing tab. */
export const initialTab = (search, shellRole) => tabFromSearch(search) ?? landingTab(shellRole);

/** The landing tab for whoever is viewing: `useViewMode().shellRole`, null for a visitor. */
export function useLandingTab() {
  return landingTab(useViewMode()?.shellRole ?? null);
}

/**
 * A role tab from the public plans read: `{ plans }` for its family, in the
 * read's order (free first), or `{ none: true }` when the catalogue sells that
 * role no plan. `{ unreadable: true }` when the read is not the plans' shape.
 */
export function roleTab(read, tab) {
  const family = PRICING_TABS.find((t) => t.key === tab)?.family;
  if (!family) return { unreadable: true };
  if (!read || !Array.isArray(read.plans)) return { unreadable: true };
  const plans = read.plans.filter((p) => p && p.family === family);
  return plans.length ? { plans } : { none: true, line: NO_PLAN_LINE };
}

/** The Models tab: the models as the Worker sends them, or `{ unreadable: true }`. */
export function modelsTab(read) {
  if (!read || !Array.isArray(read.models)) return { unreadable: true };
  return { models: read.models.filter((m) => m && typeof m.id === 'string') };
}

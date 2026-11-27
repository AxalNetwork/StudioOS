/**
 * D4120 (#4120): the 8 skill areas' tokens, in one place.
 *
 * The SkillEnergy visual, the area chips on Team › Skills and the SkillRadar's
 * axes all read this table, so an area is the same colour everywhere. The
 * values are the SkillEnergy canvas's EN6 spec sheet (owner decision
 * 2026-11-02, style B):
 *
 *   · `light` is drawn on #ffffff, `dark` on #111827. Light tokens share Axal
 *     violet's lightness (OKLCH L 0.54) and dark tokens share #a78bfa's
 *     (L 0.71). Every one is at least 4.5:1 on its background.
 *   · `angle` is the area's axis on the 8-axis radar, clockwise from the top,
 *     in the radar's order (SKILL_AXIS_ORDER). SkillEnergy points that way.
 *   · `dash` is the area's stroke rhythm (viewBox units at 100 px), so an area
 *     reads by form as well as by colour.
 *
 * `axis` is the slug the radar and the skill taxonomy use (`category_slug`).
 */
import { SKILL_AXIS_ORDER } from './assessmentMeta.js';

export const SKILL_AREAS = [
  { axis: 'product', key: 'product', name: 'Product', angle: 0, hue: 'Violet', light: '#7c3aed', dark: '#a78bfa', dash: '', form: 'solid' },
  { axis: 'engineering', key: 'engineering', name: 'Engineering', angle: 45, hue: 'Blue', light: '#2564e0', dark: '#6d9ffd', dash: '5 2.5', form: 'long dash' },
  { axis: 'design', key: 'design', name: 'Design', angle: 90, hue: 'Sky', light: '#0279a2', dark: '#0bb0e9', dash: '0.1 2.6', form: 'dotted' },
  { axis: 'gtm_sales', key: 'gtm', name: 'GTM', angle: 135, hue: 'Cyan', light: '#007e84', dark: '#04b7bf', dash: '7 2 1.2 2', form: 'dash-dot' },
  { axis: 'marketing_brand', key: 'marketing', name: 'Marketing', angle: 180, hue: 'Emerald', light: '#008455', dark: '#04bf7e', dash: '2.4 1.8', form: 'short dash' },
  { axis: 'finance_ops', key: 'finance', name: 'Finance', angle: 225, hue: 'Amber', light: '#98610c', dark: '#dd8d01', dash: '10 2', form: 'long rule' },
  { axis: 'legal_compliance', key: 'legal', name: 'Legal', angle: 270, hue: 'Pink', light: '#bf2374', dark: '#ec72a6', dash: '4 1.5 4 4', form: 'paired dash' },
  { axis: 'capital_network', key: 'capital', name: 'Capital', angle: 315, hue: 'Fuchsia', light: '#a336ae', dark: '#d17cd9', dash: '0.1 2.4 5 2.4', form: 'dot-dash' },
];

/** The five levels and how dense each one draws (EN6's density curve). */
export const SKILL_LEVELS = [
  { level: 1, name: 'Aware', n: 0.32, op: 0.42, w: 0.9, layers: 1, glow: 0.05 },
  { level: 2, name: 'Working', n: 0.48, op: 0.55, w: 1, layers: 1, glow: 0.08 },
  { level: 3, name: 'Proficient', n: 0.66, op: 0.68, w: 1.05, layers: 2, glow: 0.11 },
  { level: 4, name: 'Advanced', n: 0.84, op: 0.8, w: 1.1, layers: 2, glow: 0.14 },
  { level: 5, name: 'Expert', n: 1, op: 0.92, w: 1.15, layers: 3, glow: 0.18 },
];

// The table is the radar's order, or every angle is wrong: fail at load, not on screen.
if (SKILL_AREAS.map((a) => a.axis).join() !== SKILL_AXIS_ORDER.join()) {
  throw new Error('skillAreas: SKILL_AREAS is not in SKILL_AXIS_ORDER');
}

/** The area for a radar slug, a key or a name ("finance_ops", "finance", "Finance"); null when none. */
export function areaOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  return SKILL_AREAS.find((a) => a.axis === s || a.key === s || a.name.toLowerCase() === s) || null;
}

/**
 * CSS custom properties carrying an area's two tokens. Pair them with the
 * literal classes `bg-[var(--area-l)] dark:bg-[var(--area-d)]` (or `fill-`, `text-`)
 * so the one element switches with the page's theme.
 */
export function areaVars(area) {
  const a = typeof area === 'object' && area ? area : areaOf(area);
  return a ? { '--area-l': a.light, '--area-d': a.dark } : undefined;
}

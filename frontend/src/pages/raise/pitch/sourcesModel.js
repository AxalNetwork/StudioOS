/**
 * D896 (#2675, part 2 of #2434) — the words and derivations of the deck's
 * sources: the chips, the Sources panel (PD10), the Sources step of New deck
 * (PD4), the legend (PD10b) and the coverage meter (PD11). Pure, so the tests
 * read them without a browser.
 *
 * Everything here reads `GET /api/decks/sources` (lib/api/deckSources.js). An
 * item the Worker calls `not_recorded` reads "Not recorded on StudioOS", with
 * the module that fills it; it is never 0. The grades and sources are the
 * Worker's (`sourceAndGrade` in services/decks/sources.ts); this file only
 * words them.
 */

import { dayLabel } from './pitchStudioModel.js';

export const NOT_ON_STUDIOOS = 'Not recorded on StudioOS';

/** The grades a recorded value carries, strongest first, then the gap. */
export const GRADES = ['Measured', 'Reviewed', 'Sourced', 'Stated'];

export const AREA_ORDER = ['validate', 'build', 'raise', 'grow', 'team', 'scoring'];
export const AREA_LABEL = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow', team: 'Team', scoring: 'Scoring' };
export const SCORING_NOTE = 'Shown only if you include it. Investors see a band, never your raw score.';

/** The five sources and five grades, one line each (PD10b). */
export const LEGEND_SOURCES = [
  { id: 'Connector', icon: '◆', line: 'From a connected tool.' },
  { id: 'Document', icon: '▤', line: 'A file backs it.' },
  { id: 'Recorded', icon: '●', line: 'A logged interview or recorded session.' },
  { id: 'Signed', icon: '✓', line: 'An e-signed document or filed form.' },
  { id: 'Typed', icon: 'T', line: 'The founder entered it.' },
];
export const LEGEND_GRADES = [
  { id: 'Measured', line: 'From a connected tool, or counted from records.' },
  { id: 'Reviewed', line: 'Set by someone other than the founder.' },
  { id: 'Sourced', line: 'Typed with a link or file.' },
  { id: 'Stated', line: 'Typed, no source.' },
  { id: 'Not recorded', line: 'Nothing on StudioOS yet.' },
];
export const LEGEND_TITLE = 'How sources and grades work';
export const LEGEND_LEAD = 'Every figure on a card carries a chip: where it came from, the record, the date, and how strong it is. Hover any chip to see this.';
export const LEGEND_NOTE = 'Investors see the same chips. A Stated figure is still yours to use; the Check panel just tells you it stands on your word alone.';

const SOURCE_ICON = Object.fromEntries(LEGEND_SOURCES.map((s) => [s.id, s.icon]));
const SOURCE_LINE = Object.fromEntries(LEGEND_SOURCES.map((s) => [s.id, s.line]));
const GRADE_LINE = Object.fromEntries(LEGEND_GRADES.map((g) => [g.id, g.line]));

/** The connected tool a Connector value came from, named by its record. */
const CONNECTOR = [
  [/^project_metrics:/, 'Stripe'], [/^mercury_raise_facts:/, 'Mercury'], [/^(roadmap_releases|github_contributors|mvp_features):/, 'GitHub'],
  [/^cap_table_(holders|vesting):/, 'Carta'],
];

const money = (dollars) => `$${Math.round(dollars).toLocaleString('en-US')}`;

/** A recorded value in the canvas's words; `null` when nothing is recorded. */
export function valueText(item) {
  if (!item || item.state !== 'recorded' || item.value == null) return null;
  const v = item.value;
  const n = Number(v);
  switch (item.unit) {
    case 'usd': return Number.isFinite(n) ? money(n) : null;
    case 'cents': return Number.isFinite(n) ? money(n / 100) : null;
    case 'percent': return Number.isFinite(n) ? `${Number(n.toFixed(1))}%` : null;
    case 'months': return Number.isFinite(n) ? `${Number(n.toFixed(1))} months` : null;
    case 'date': return dayLabel(v);
    case 'count': {
      if (!Number.isFinite(n)) return null;
      if (item.of == null) return String(n);
      return item.source_key === 'build.commits_90d' ? `${n} by ${item.of}` : `${n} of ${item.of}`;
    }
    default: return String(v);
  }
}

/** "From Stripe" for a connected tool, else "From <module>". */
export function recordLine(item) {
  if (item?.source === 'Connector') {
    const hit = CONNECTOR.find(([re]) => re.test(String(item.record_ref || '')));
    if (hit) return `From ${hit[1]}`;
  }
  return `From ${item?.module || 'StudioOS'}`;
}

/** The chip under a figure, and the sentence it explains itself with on hover. */
export function chipOf(item) {
  if (!item || item.state !== 'recorded' || !item.source) return null;
  const date = item.as_of ? dayLabel(item.as_of) : null;
  return {
    source: item.source,
    icon: SOURCE_ICON[item.source] || '',
    record: recordLine(item),
    date,
    grade: item.grade,
    title: `${item.source}: ${String(SOURCE_LINE[item.source] || '').replace(/\.$/, '').toLowerCase()}. ${item.grade}: ${String(GRADE_LINE[item.grade] || '').replace(/\.$/, '').toLowerCase()}.`,
  };
}

/** What a slot's row says when there is no value. */
export function gapLine(item) {
  if (!item) return null;
  if (item.state === 'unreadable') return 'Could not be read';
  if (item.state === 'withheld') return 'Only the founder reads this';
  if (item.state === 'not_recorded') return NOT_ON_STUDIOOS;
  return null;
}

/** "Add it in Grow › Revenue and traction ›", the dashed row's link. */
export const fillLink = (item) => ({ text: `Add it in ${item.module} ›`, href: item.href });

const SHOW = { grow: 3 };
const PIN = { grow: ['grow.mrr', 'grow.paying_customers', 'grow.churn'] };

/**
 * The items grouped by area, as the panel and the Sources step draw them. Each
 * group shows its first two items (Grow its first three, with MRR, paying
 * customers and churn first) and "Show [n] more"; an expanded group shows all.
 * In Grow, a stale or missing row stays in view whatever the count (PD10).
 * Scoring always shows both rows, with its note.
 */
export function groupSources(items, { search = '', grade = 'all', staleOnly = false, stale = new Map(), expanded = new Set() } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  const keep = (it) => {
    if (it.state === 'withheld') return false;
    if (needle && !`${it.label} ${it.module}`.toLowerCase().includes(needle)) return false;
    if (grade !== 'all' && (grade === 'Not recorded' ? it.state === 'recorded' : it.grade !== grade)) return false;
    if (staleOnly && !stale.has(it.source_key)) return false;
    return true;
  };
  const groups = [];
  for (const area of AREA_ORDER) {
    let list = (items || []).filter((it) => it.area === area && keep(it));
    if (!list.length) continue;
    const pin = PIN[area];
    if (pin) {
      const rank = (it) => { const i = pin.indexOf(it.source_key); return i < 0 ? 99 : i; };
      list = [...list].sort((a, b) => rank(a) - rank(b));
    }
    const limit = area === 'scoring' || expanded.has(area) ? list.length : (SHOW[area] || 2);
    let shown = list.slice(0, limit);
    if (area === 'grow') {
      const sticky = list.slice(limit).filter((it) => it.state !== 'recorded' || stale.has(it.source_key));
      shown = [...shown, ...sticky];
    }
    const hidden = list.length - shown.length;
    groups.push({
      id: area, label: AREA_LABEL[area], note: area === 'scoring' ? SCORING_NOTE : null,
      items: shown, more: hidden > 0 ? `Show ${hidden} more` : null,
    });
  }
  return groups;
}

/** The PD11 meter from the read's coverage: counts per grade, with the gap last. */
export function meterOf(coverage) {
  if (!coverage || !Number.isFinite(Number(coverage.slots))) return null;
  const slots = Number(coverage.slots);
  const filled = Number(coverage.filled) || 0;
  const gap = slots - filled;
  const segments = [...GRADES.map((g) => ({ key: g, n: Number(coverage.by_grade?.[g]) || 0 })), { key: 'Not recorded', n: gap }];
  return {
    slots, filled, segments,
    label: `${filled} of ${slots} slots`,
    short: `${filled} of ${slots}`,
    state: slots === 0 || filled === 0 ? 'empty' : filled === slots ? 'full' : 'partial',
  };
}

export const METER_LOADING = 'Reading…';
export const METER_ERROR = 'Coverage could not be read';
export const METER_SUB = 'can be filled from your records';
export const METER_EMPTY = 'StudioOS has nothing to fill from yet. Start with Validate › Customer research or connect Stripe.';

/** The "Missing" list beside the meter: every slot nothing fills, with its module. */
export function missingRows(items) {
  return (items || []).filter((it) => it.state === 'not_recorded' && !it.optional).map((it) => ({ key: it.source_key, label: it.label, ...fillLink(it) }));
}

/** The refresh read's stale bindings by key, for "Stale only" and the row note. */
export function staleKeys(refresh) {
  return new Map((refresh?.rows || []).filter((r) => r.state === 'stale').map((r) => [r.source_key, r.bound || {}]));
}

/** "Changed since 30 Sep": the date the card's binding was read. */
export const changedSince = (bound) => (bound?.as_of ? `Changed since ${dayLabel(bound.as_of)}` : 'Changed since this card was saved');

/** What the scorecard dialog says investors would see (owner question 4: a band, never the number). */
export function scorecardDialog(item) {
  const band = item && item.state === 'recorded' ? valueText(item) : null;
  return {
    title: `Include your ${item?.source_key === 'scoring.pmf_band' ? 'Product-market fit band' : 'scorecard band'} on this deck?`,
    body: band
      ? `Investors will see ${band}, the model version and the date. Never the number.`
      : 'No band is recorded on StudioOS yet, so investors would see nothing. Never the number.',
    keepOff: 'Keep it off',
    include: 'Include the band',
    canInclude: Boolean(band),
  };
}

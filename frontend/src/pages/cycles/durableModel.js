/**
 * D6122 (#6122, GR-21, GR-24, GR-27) — Grow › Company's pure rules: the due strip over the
 * obligations, the line under the header, and how each durability-checklist item was ticked.
 * The page and `frontend/test/grow_company_6122.test.mjs` share them.
 */

/** The due strip's four windows, in the canvas's order; each filters the obligations (`due_window`). */
export const DUE_WINDOWS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'next_30', label: 'Next 30 days' },
  { key: 'next_90', label: 'Next 90 days' },
  { key: 'later', label: 'Later' },
];

/**
 * The strip's chips from the read's `parts.due_counts`. A read without counts draws no strip
 * (null), never four zeros; a window with none reads 0 beside its label, its population.
 */
export function dueChips(counts, active) {
  if (!counts || typeof counts !== 'object') return null;
  if (!DUE_WINDOWS.every((w) => Number.isInteger(counts[w.key]) && counts[w.key] >= 0)) return null;
  return DUE_WINDOWS.map((w) => ({ ...w, count: counts[w.key], pressed: active === w.key, alarm: w.key === 'overdue' && counts[w.key] > 0 }));
}

/** Pressing a pressed chip clears its filter; pressing another sets it. Page 1 either way. */
export function toggleDue(query, key) {
  const filter = { ...(query?.filter || {}) };
  if (filter.due_window === key) delete filter.due_window; else filter.due_window = key;
  return { ...(query || {}), page: 1, filter };
}

const DAY = 86_400_000;
const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Next 90 days · 14 Nov 2026 – 12 Feb 2027", from the Worker's own day (`parts.due_on`); null without one. */
export function rangeLine(on) {
  if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const start = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  return `Next 90 days · ${fmt(start)} – ${fmt(start + 90 * DAY)}`;
}

/** The count under the table: open ones, and those in no window (done or snoozed). */
export function openLine(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const open = DUE_WINDOWS.reduce((n, w) => n + (Number.isInteger(counts[w.key]) ? counts[w.key] : 0), 0);
  const none = Number.isInteger(counts.none) ? counts.none : 0;
  return `${open} open · soonest due first${none ? ` · ${none} done or snoozed (in no due window)` : ''}`;
}

const day = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const ms = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : fmt(ms);
};

/**
 * A checklist item's second line (GR-24): a done one says what ticked it and when; an open one
 * says what will ("Ticks from the Spin-Out Lab", "Tick by hand"). Nothing is said that the read
 * does not hold.
 */
export function tickLine(item) {
  if (!item || typeof item !== 'object') return null;
  // D6789 (#6789): an item marked Not applicable says who marked it and when.
  if (item.not_applicable) {
    const by = typeof item.not_applicable_by === 'string' && item.not_applicable_by.trim() ? `by ${item.not_applicable_by.trim()}` : null;
    return ['Not applicable', by, day(item.not_applicable_at)].filter(Boolean).join(' · ');
  }
  if (item.done) {
    const src = item.source;
    if (typeof src === 'string' && src.startsWith('From Mercury')) return src;
    const who = src === 'Spin-Out Lab' ? 'Spin-Out Lab' : src === 'manual' ? 'By hand' : null;
    return [who, day(item.done_at)].filter(Boolean).join(' · ') || 'Done';
  }
  if (item.ticks === 'lab') return 'Open · Ticks from the Spin-Out Lab';
  if (item.ticks === 'mercury') return 'Open · Ticks from Mercury at twelve months, or by hand';
  return 'Open · Tick by hand';
}

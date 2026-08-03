// Pitch Deck Builder — view model adapter.
//
// Single transformation from the live Spin-Out Lab field map (the flat
// dotted-key payload behind useSpinoutDeckFields → POST
// /projects/:id/spinout-deck) into everything the Claude Design's Pitch Deck
// Builder renders: slide cards, per-slide readiness, week pills, readiness
// counts, and export/share UI state.
//
// Design reference: spin-out-lab-pipeline/project/Pitch Deck Builder.dc.html
// (slideMeta(), slideStatus(), weekPills, readyCount/readyPct, exportDisabled).
// The design ships hardcoded demo values; everything here is derived from real
// data, with explicit `unknown` handling so a missing field map renders a
// deterministic "sample data" state instead of broken/NaN UI.

/** The 11 deck slides. `spec` matches SpinoutSlideEditor's CONFIG keys and the
 *  stored deck spec_id; `prefix` is the hydrate() section each slide reads;
 *  `week` is the Lab week that sources it (0 = studio profile). */
export const SLIDE_META = [
  { spec: 'cover', title: 'Cover', week: 0, prefix: 'cover' },
  { spec: 'problem', title: 'Problem', week: 1, prefix: 'problem' },
  { spec: 'validation', title: 'Validation', week: 1, prefix: 'validation' },
  { spec: 'market', title: 'Market', week: 1, prefix: 'market' },
  { spec: 'solution', title: 'Solution', week: 1, prefix: 'solution' },
  { spec: 'product_demo', title: 'Product Demo', week: 3, prefix: 'productDemo' },
  { spec: 'roadmap', title: 'Roadmap', week: 3, prefix: 'roadmap' },
  { spec: 'team_network', title: 'Team & Network', week: 2, prefix: 'team' },
  { spec: 'cap_table', title: 'Cap Table', week: 2, prefix: 'captable' },
  { spec: 'ask', title: 'The Ask · Use of Funds', week: 4, prefix: 'ask' },
  { spec: 'review_the_deal', title: 'Deal Readiness', week: 4, prefix: 'deal' },
];

export const WEEKS = [
  { num: 1, label: 'Validate' },
  { num: 2, label: 'Structure' },
  { num: 3, label: 'Build' },
  { num: 4, label: 'Pitch' },
];

/** Design rule: export unlocks once 6 of 11 slides carry real data. */
export const EXPORT_MIN_READY = 6;

/** Per-slide readiness from the flat dotted-key field map.
 *  → { state: 'ready'|'partial'|'missing'|'unknown', filled, total, missing }.
 *  `unknown` (no keys for this prefix) means the deck is showing template
 *  sample content — deliberately distinct from `missing`, which means the
 *  source tool has the field but the founder hasn't filled it. */
export function slideStatus(meta, fields) {
  if (!fields || typeof fields !== 'object') return { state: 'unknown', filled: 0, total: 0, missing: 0 };
  const pref = `${meta.prefix}.`;
  let total = 0;
  let filled = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith(pref)) continue;
    total += 1;
    const s = v == null ? '' : String(v).trim();
    if (s !== '' && s !== '—') filled += 1;
  }
  if (total === 0) return { state: 'unknown', filled: 0, total: 0, missing: 0 };
  const missing = total - filled;
  if (missing === 0) return { state: 'ready', filled, total, missing };
  if (filled === 0) return { state: 'missing', filled, total, missing };
  return { state: 'partial', filled, total, missing };
}

/** Card sub-label per state (design statusText()). */
export function statusTextFor(status) {
  switch (status.state) {
    case 'ready': return 'Data populated from your work';
    case 'partial': return `Partial — ${status.missing} field${status.missing === 1 ? '' : 's'} missing`;
    case 'missing': return 'No data yet — complete the source tool';
    default: return 'Sample data shown';
  }
}

/** Status dot colour (design dotFor()). Tailwind classes, dark-mode aware. */
export const DOT_CLASS = {
  ready: 'bg-emerald-500',
  partial: 'bg-amber-500',
  missing: 'bg-gray-300 dark:bg-gray-600',
  unknown: 'bg-gray-300 dark:bg-gray-600',
};

/** Week pill state aggregated from the slides that week sources.
 *  done  — every slide for the week is ready
 *  warn  — some progress, N slides still incomplete
 *  pending — nothing started (or only sample data) */
function weekPillFor(week, slides) {
  const mine = slides.filter((s) => s.week === week.num);
  if (mine.length === 0) return { ...week, state: 'pending', note: '' };
  if (mine.every((s) => s.status.state === 'ready')) return { ...week, state: 'done', note: '' };
  const incomplete = mine.filter((s) => s.status.state !== 'ready' && s.status.state !== 'unknown').length;
  if (mine.some((s) => s.status.state === 'ready' || s.status.state === 'partial')) {
    return { ...week, state: 'warn', note: `${incomplete} item${incomplete === 1 ? '' : 's'} missing` };
  }
  return { ...week, state: 'pending', note: '' };
}

/** Full page view model. Pure — safe to call on every render.
 *  @param fields  live field map (or null while loading / unavailable)
 *  @param canExport  gate the export button on having a resolvable deck */
export function buildPitchDeckViewModel({ fields, canExport = true } = {}) {
  const slides = SLIDE_META.map((meta, i) => {
    const status = slideStatus(meta, fields);
    return {
      ...meta,
      index: i,
      n: i + 1,
      status,
      complete: status.state === 'ready',
      statusText: statusTextFor(status),
      dotClass: DOT_CLASS[status.state],
    };
  });

  const total = slides.length;
  const readyCount = slides.filter((s) => s.complete).length;
  const readyPct = total ? Math.round((readyCount / total) * 100) : 0;
  const exportDisabled = !canExport || readyCount < EXPORT_MIN_READY;

  return {
    slides,
    total,
    readyCount,
    readyPct,
    weekPills: WEEKS.map((w) => weekPillFor(w, slides)),
    exportDisabled,
    exportTip: exportDisabled
      ? `Complete at least ${EXPORT_MIN_READY} slides to export`
      : `Export all ${total} slides as PDF`,
    readyLabel: `${readyCount} of ${total} slides ready`,
  };
}

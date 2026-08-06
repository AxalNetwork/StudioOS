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
 *  stored deck spec_id; `prefix` is the hydrate() section each slide reads —
 *  merged slides list every section they read via `prefixes` (Problem absorbs
 *  the validation funnel; Ask absorbs the cap table), so a gap in any of those
 *  sections marks the host slide partial; `week` is the Lab week that sources
 *  it (0 = studio profile). */
export const SLIDE_META = [
  { spec: 'cover', title: 'Cover', week: 0, prefix: 'cover' },
  { spec: 'problem', title: 'Problem & Validation', week: 1, prefix: 'problem', prefixes: ['problem', 'validation'] },
  { spec: 'solution', title: 'Solution', week: 1, prefix: 'solution' },
  { spec: 'product_demo', title: 'Product Demo', week: 3, prefix: 'productDemo' },
  { spec: 'market', title: 'Market', week: 1, prefix: 'market' },
  { spec: 'competitive', title: 'Competitive', week: 1, prefix: 'competitive' },
  { spec: 'traction', title: 'Traction', week: 3, prefix: 'traction' },
  { spec: 'roadmap', title: 'Roadmap', week: 3, prefix: 'roadmap' },
  { spec: 'team_network', title: 'Team & Network', week: 2, prefix: 'team' },
  { spec: 'ask', title: 'The Ask · Cap Table', week: 4, prefix: 'ask', prefixes: ['ask', 'captable'] },
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

/**
 * Per-slide readiness.
 *
 * READ THIS BEFORE CHANGING THE SIGNAL IT USES. Readiness comes from the
 * worker's `gaps` / `gap_sections`, NOT from counting entries in `fields`.
 *
 * The obvious implementation — walk `fields`, count how many keys under this
 * slide's prefix are non-empty — is wrong, and was wrong here for real users.
 * `flattenSpinoutDeckData` (worker side) SKIPS empty scalars, so an unfilled
 * field is simply absent from the map rather than present-and-empty. Every key
 * that exists is non-empty by construction, `filled` always equalled `total`,
 * and every slide reported `ready`. A founder who had done no work at all saw
 * eleven green ticks and "Data populated from your work" under eleven slides of
 * template fallback content — the deck was showing the sample and calling it
 * theirs.
 *
 * The worker has always known better. Each time a module is empty it substitutes
 * template figures so the slide still renders, and raises a gap saying so;
 * `gap_sections` names the slide. That list is the readiness contract.
 *
 * @param meta    a SLIDE_META entry
 * @param fields  live field map (or null) — only used to tell "no data at all"
 *                from "data, with gaps"
 * @param gaps    { gaps, gapSections } from useSpinoutDeckFields, or null
 * → { state: 'ready'|'partial'|'unknown', gaps: string[], missing }
 *
 * `unknown` means the deck is showing template sample content because we could
 * not load the bundle at all (signed-out preview, paywall, request failed) —
 * deliberately distinct from a slide whose module is merely empty, which is
 * `partial` and names what to go and fill in.
 */
export function slideStatus(meta, fields, gaps = null) {
  const list = Array.isArray(gaps?.gaps) ? gaps.gaps : null;
  const sections = Array.isArray(gaps?.gapSections) ? gaps.gapSections : null;

  // No bundle, or a bundle from a worker that does not report sections: we
  // cannot claim the slide is complete. Say "sample" rather than guess — an
  // over-optimistic default is the bug this function exists to prevent.
  if (!fields || typeof fields !== 'object' || !list || !sections) {
    return { state: 'unknown', gaps: [], missing: 0 };
  }

  const prefixes = Array.isArray(meta.prefixes) ? meta.prefixes : [meta.prefix];
  const mine = list.filter((_, i) => prefixes.includes(sections[i]));
  if (mine.length === 0) return { state: 'ready', gaps: [], missing: 0 };
  return { state: 'partial', gaps: mine, missing: mine.length };
}

/** Card sub-label per state (design statusText()). */
export function statusTextFor(status) {
  switch (status.state) {
    case 'ready': return 'Data populated from your work';
    // Name the first thing to go and do, not a count. The gap text is already
    // written as an instruction naming the module ("Problem: cluster discovery
    // pains in the Customer Discovery module."), which is more use to a founder
    // than "2 fields missing" — and the slide sub-label is the only place they
    // will see it before exporting.
    case 'partial': return status.gaps?.[0]
      ? status.gaps[0]
      : `${status.missing} item${status.missing === 1 ? '' : 's'} still needed`;
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
  // Nothing loaded (paywall / signed-out preview / failed request): the deck is
  // showing sample content, so no week can claim to be done.
  if (mine.every((s) => s.status.state === 'unknown')) return { ...week, state: 'pending', note: '' };
  const incomplete = mine.filter((s) => s.status.state !== 'ready').length;
  // Guarded, not implied: the old version could reach the warn branch with
  // incomplete === 0 and render the self-contradicting pill
  // "Build — Week 3, 0 items missing" (visible in the reported screenshot).
  if (incomplete === 0) return { ...week, state: 'done', note: '' };
  return { ...week, state: 'warn', note: `${incomplete} item${incomplete === 1 ? '' : 's'} missing` };
}

/** Full page view model. Pure — safe to call on every render.
 *  @param fields  live field map (or null while loading / unavailable)
 *  @param canExport  gate the export button on having a resolvable deck */
export function buildPitchDeckViewModel({ fields, gaps = null, canExport = true } = {}) {
  const slides = SLIDE_META.map((meta, i) => {
    const status = slideStatus(meta, fields, gaps);
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

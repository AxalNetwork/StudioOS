/**
 * The readings the competitor-analysis page (canvas 90eb4cf2) and its tests
 * share. Pure, so they run in Node.
 *
 * THREE STATES, THREE SHAPES, as the canvas's D2–D4 insist:
 *   a failed read  — no tiles at all; we could not ask, so there is nothing to
 *                    report, not even an absence;
 *   a failed run   — Not recorded tiles; we asked, the run failed, the counts
 *                    are unknown;
 *   a finished run — a number, even 0. A run that found nothing is a fact.
 */

/** A source that actually came back: its stored status is the HTTP code. */
export function sourceFetched(s) {
  const n = Number(s?.status);
  return Number.isFinite(n) && n >= 200 && n < 400;
}

/** The four tiles for an analysis, or null for a failed read. */
export function analysisTiles(analysis, { readFailed = false } = {}) {
  if (readFailed || !analysis) return null;
  if (analysis.status === 'error') {
    return [
      { k: 'Competitors', nr: true, sub: 'the run failed before it returned' },
      { k: 'Direct', nr: true, sub: 'nothing to count' },
      { k: 'Adjacent', nr: true, sub: 'nothing to count' },
      { k: 'Sources fetched', nr: true, sub: 'no fetch was attempted' },
    ];
  }
  const cands = analysis.candidates || [];
  const fetched = (analysis.sources || []).filter(sourceFetched).length;
  return [
    { k: 'Competitors', v: String(cands.length), sub: cands.length ? 'direct + adjacent in this run' : 'none recorded yet' },
    { k: 'Direct', v: String(cands.filter((c) => c.category !== 'adjacent').length), sub: 'category = direct' },
    { k: 'Adjacent', v: String(cands.filter((c) => c.category === 'adjacent').length), sub: 'category = adjacent' },
    { k: 'Sources fetched', v: String(fetched), sub: 'public URLs, not a database' },
  ];
}

/** The inputs row: what the person actually gave the run, blanks as Not recorded. */
export function inputsRow(inputs = {}) {
  const val = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? '').trim());
  return [
    ['Market', val(inputs.market)],
    ['Customer', val(inputs.target_customer)],
    ['Geography', val(inputs.geography)],
    ['Depth', val(inputs.depth)],
    ['Known competitors', val(inputs.known_competitors)],
  ].map(([k, v]) => (v ? { k, v } : { k, nr: true }));
}

/**
 * The feature grid with features as rows and competitors as columns, as the
 * canvas draws it. The run stores the other way round (one row per
 * competitor, one value per feature). A blank cell is `null` — the page reads
 * it Not recorded, never "no": an unfetched site is not evidence that a
 * feature is absent. Null when the run returned no features, so the section
 * is omitted rather than drawn with invented heads.
 */
export function featureGrid(out = {}) {
  const fc = out.feature_comparison;
  const features = Array.isArray(fc?.features) ? fc.features.filter((f) => String(f ?? '').trim()) : [];
  const rows = Array.isArray(fc?.rows) ? fc.rows : [];
  if (!features.length || !rows.length) return null;
  return {
    head: rows.map((r) => String(r.competitor ?? '')),
    rows: features.map((f, i) => ({
      feature: f,
      cells: rows.map((r) => {
        const v = Array.isArray(r.values) ? r.values[i] : undefined;
        const t = String(v ?? '').trim();
        return t || null;
      }),
    })),
  };
}

/** The signal columns that have lines; empty ones are omitted, not drawn hollow. */
export function signalColumns(out = {}) {
  const cols = [
    { k: 'Pricing signals', lines: (out.pricing_signals || []).map((p) => ({ who: p.competitor, text: p.signal })) },
    { k: 'Hiring & content activity', lines: (out.activity_signals || []).map((p) => ({ who: p.competitor, text: p.detail, kind: p.kind })) },
    { k: 'Positioning', lines: (out.positioning || []).map((p) => ({ who: p.competitor, text: p.messaging })) },
    { k: 'Traction signals', lines: (out.traction_signals || []).map((p) => ({ who: p.competitor, text: p.signal })) },
  ];
  return cols.filter((c) => c.lines.some((l) => String(l.text ?? '').trim()));
}

/**
 * The landscape read — a restatement of what is on the page, built here and
 * not by a model, as the canvas draws it ("It will not invent a wedge, a
 * price, or a company"). Null when there is nothing to restate.
 */
export function landscapeRead(analysis) {
  if (!analysis) return null;
  const cands = analysis.candidates || [];
  const summary = String(analysis.output?.market_summary ?? '').trim();
  if (!cands.length && !summary) return null;
  const parts = [];
  if (summary) parts.push(`Market: ${summary}`);
  if (cands.length) {
    const direct = cands.filter((c) => c.category !== 'adjacent');
    const adjacent = cands.filter((c) => c.category === 'adjacent');
    const line = (c) => `${c.name}${String(c.summary ?? '').trim() ? ` — ${String(c.summary).trim()}` : ''}`;
    if (direct.length) parts.push(`Direct (${direct.length}): ${direct.map(line).join('; ')}`);
    if (adjacent.length) parts.push(`Adjacent (${adjacent.length}): ${adjacent.map(line).join('; ')}`);
  }
  const kinds = [...new Set((analysis.sources || []).filter(sourceFetched).map((s) => s.kind).filter(Boolean))];
  if (kinds.length) parts.push(`Read from their ${kinds.join(', ')} pages.`);
  return parts.join('\n');
}

/** Accept: the read goes into notes after what is there, never over it. */
export function notesWithRead(notes, read) {
  const had = String(notes ?? '').trim();
  return had ? `${had}\n\nLandscape read:\n${read}` : `Landscape read:\n${read}`;
}

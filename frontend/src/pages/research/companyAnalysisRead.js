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
    // D7175: the reads tried beside the reads fetched, so a failed read shows.
    { k: 'Sources fetched', v: String(fetched), sub: `${fetched} of ${(analysis.sources || []).length} tried · public URLs` },
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

/* ---------------------------------------------------------------------------
 * D7175 (#7175, canvas D7041, boards RS-13): a fixed subject, and no finding
 * without a source. One evidence vocabulary for setup, results, the saved list
 * and the export, read from the Worker's `evidence` (never worked out here
 * from a guess), and the readings the subject card, the findings and the
 * competitor table draw.
 * ------------------------------------------------------------------------- */

/** The evidence words, as the canvas's vocabulary names them. `tone` picks the chip's shape. */
export const EVIDENCE = Object.freeze({
  supported: { word: 'Supported', tone: 'ok' },
  partial: { word: 'Partial', tone: 'partial' },
  insufficient: { word: 'Insufficient evidence', tone: 'insufficient' },
  no_candidates: { word: 'No candidates', tone: 'none' },
  unavailable: { word: 'Sources unavailable', tone: 'unavailable' },
});

/** The evidence chip's label for a run: null when the run has no status (not complete). */
export function evidenceLabel(evidence) {
  const e = evidence && EVIDENCE[evidence.status];
  if (!e) return null;
  if (evidence.status === 'supported') return `${e.word} · every finding names a source`;
  if (evidence.status === 'partial' && evidence.findings) return `${e.word} · ${evidence.findings_with_source} of ${evidence.findings} findings have a source`;
  return e.word;
}

/** Source id → its number: fetched sources only, from 1, in the order the API lists them (as the export numbers them). */
export function sourceNumbers(sources = []) {
  const m = new Map();
  for (const s of sources) if (sourceFetched(s)) m.set(String(s.id), m.size + 1);
  return m;
}

/**
 * The findings as the page draws them: Source facts and Interpretation apart,
 * each with the numbers of the fetched sources it cites. A citation to a
 * source that failed or was removed is dropped, and a finding left with none
 * is `noSource` ("No source in this run"), never drawn as cited.
 */
export function findingsOf(out = {}, sources = []) {
  const n = sourceNumbers(sources);
  const rows = (Array.isArray(out?.findings) ? out.findings : [])
    .filter((f) => String(f?.text ?? '').trim())
    .map((f) => {
      const cites = [...new Set((Array.isArray(f.source_ids) ? f.source_ids : []).map((id) => n.get(String(id))).filter(Boolean))];
      return { text: String(f.text).trim(), kind: f.kind === 'interpretation' ? 'interpretation' : 'fact', cites, noSource: !cites.length };
    });
  return { facts: rows.filter((r) => r.kind === 'fact'), interpretation: rows.filter((r) => r.kind === 'interpretation') };
}

/** One source chip's words: "homepage · fetched", "about · Unavailable · 503", "homepage · Unavailable · timed out". */
export function sourceChip(s, n) {
  const ok = sourceFetched(s);
  const code = Number(s?.status);
  return { n: ok ? n : null, ok, label: `${s?.kind || 'page'} · ${ok ? 'fetched' : `Unavailable · ${code || 'timed out'}`}`, url: s?.url || '' };
}

/**
 * What a competitor's classification rests on: its source chips, how many of
 * its reads came back, and whether the classification is unconfirmed (no
 * fetched source: its site failed, or it has no website and nothing was tried).
 */
export function candidateSupport(c, sources = []) {
  const n = sourceNumbers(sources);
  const mine = sources.filter((s) => String(s.candidate_id) === String(c?.id));
  const chips = mine.map((s) => sourceChip(s, n.get(String(s.id))));
  const fetched = chips.filter((x) => x.ok).length;
  return { chips, fetched, tried: mine.length, unconfirmed: fetched === 0, notAttempted: !mine.length && !c?.url && !c?.domain };
}

/** The classification word a row shows: an unconfirmed one says so. */
export function classificationWord(c, support) {
  const base = c?.category === 'adjacent' ? 'Adjacent' : 'Direct';
  return support?.unconfirmed ? `${base} · unconfirmed` : base;
}

/** The failed reads, for the Partial bar's "Retry the N reads". */
export function failedReads(sources = []) {
  return sources.filter((s) => !sourceFetched(s));
}

/** A website as the card prints it: the host, without scheme or `www.`. */
export function siteHost(website) {
  const raw = String(website ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

/**
 * The subject card's state from one read of `GET /research/company-directory/:uid`
 * (`read` is { loading, error, data }): loading · unavailable (the read failed;
 * only the name from the link is shown) · missing (no such company) · ok, with
 * the website's own state: verified, not_verified or not_recorded.
 */
export function subjectCard(read, linkName = '') {
  if (!read || read.loading) return { state: 'loading', name: linkName };
  if (read.error) return { state: Number(read.error.status) === 404 ? 'missing' : 'unavailable', name: linkName };
  const item = read.data?.item || {};
  const website = String(item.website ?? '').trim();
  const websiteStatus = !website ? 'not_recorded' : (item.website_status === 'verified' || item.website_verified_at) ? 'verified' : 'not_verified';
  return {
    state: 'ok',
    uid: item.uid || null,
    name: item.name || linkName,
    website,
    host: siteHost(website),
    websiteStatus,
    verifiedAt: item.website_verified_at || null,
    source: item.source_name || null,
    sourceUrl: item.source_url || null,
    license: item.source_license || null,
    asOf: item.as_of || null,
    sector: String(item.sector ?? '').trim(),
  };
}

/**
 * Self-match protection in the Known competitors field: a typed name that is
 * the subject's name, uid or site is refused there, as the Worker refuses it.
 */
export function isSubjectName(subject, typed) {
  if (!subject) return false;
  const key = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const t = key(typed);
  if (!t) return false;
  if (t === key(subject.name) || (subject.uid && t === key(subject.uid))) return true;
  const host = siteHost(subject.website);
  return !!host && /\./.test(t) && siteHost(t) === host;
}

/**
 * Revise the search (RS-13 B3): the setup form with this run's subject and
 * inputs kept, so the reader changes what they want and runs again.
 */
export function reviseHref(analysis) {
  const i = analysis?.inputs || {};
  const p = new URLSearchParams({ tab: 'analyses' });
  if (analysis?.subject_uid) {
    p.set('company', analysis.subject_uid);
    if (i.subject?.name) p.set('name', i.subject.name);
  }
  for (const [k, v] of [['market', i.market], ['customer', i.target_customer], ['geography', i.geography],
    ['region', i.region_focus], ['depth', i.depth], ['known', i.known_competitors]]) {
    const t = String(v ?? '').trim();
    if (t) p.set(k, t.slice(0, 200));
  }
  return `/research/companies?${p.toString()}`;
}

/** Known competitors as a list: comma, semicolon or newline separate names. */
export const splitNames = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

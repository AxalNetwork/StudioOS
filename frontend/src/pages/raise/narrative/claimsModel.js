/**
 * D912 (#2696) — the Investor narrative's Claims (NAR6), the claim lightbox
 * (NAR7, NAR7b) and the Check (NAR8), from `GET /narrative/:version/claims`
 * (D1264's store). Pure: no React and no fetch, so
 * `frontend/test/narrative_claims_d912.test.mjs` holds each rule.
 *
 * THE STATES ARE THE CHECK'S. Nothing here decides one: a claim is Backed,
 * Founder's figure, Mismatch or Not backed because D1264 said so. A Mismatch
 * keeps both figures and both sources; neither is presumed right. A record's
 * figure is drawn only when the read carries it (the founder's); staff read
 * the state alone.
 */
import { HOME_PATH, NOT_RECORDED, tabSearch } from './narrativeModel';

export { NOT_RECORDED };

export const STATES = Object.freeze([
  { key: 'mismatch', label: 'Mismatch', tone: 'bad', rank: 0 },
  { key: 'not_backed', label: 'Not backed', tone: 'amber', rank: 1 },
  { key: 'founders_figure', label: 'Founder’s figure', tone: 'lav', rank: 2 },
  { key: 'backed', label: 'Backed', tone: 'ok', rank: 3 },
]);
const STATE = new Map(STATES.map((s) => [s.key, s]));
/** A state the store does not send is Not recorded, never a guess. */
export const stateOf = (key) => STATE.get(key) || { key, label: NOT_RECORDED, tone: 'grey', rank: 9 };

/** The best source's word, best first (D1264's ranking). */
export const SOURCES = Object.freeze([
  { key: 'connector', label: 'Connector' },
  { key: 'signed', label: 'Signed' },
  { key: 'document', label: 'Document' },
  { key: 'recorded', label: 'Recorded' },
  { key: 'typed', label: 'Typed' },
]);
const SOURCE = new Map(SOURCES.map((s) => [s.key, s.label]));
export const sourceWord = (src) => (src?.label ? SOURCE.get(src.label) || NOT_RECORDED : 'No record');

/** A state that needs the founder: a Mismatch, then a Not-backed claim. */
export const needsYou = (c) => c?.state === 'mismatch' || c?.state === 'not_backed';

/** The rows as NAR6 draws them: needs-you first, then by section, then by figure. */
export function claimRows(read) {
  const claims = Array.isArray(read?.claims) ? read.claims : [];
  return claims
    .map((c) => ({
      id: c.id,
      section: c.section?.label || 'Elsewhere in the narrative',
      sectionKey: c.section?.key || 'other',
      figure: c.figure || NOT_RECORDED,
      stated: c.stated ?? NOT_RECORDED,
      state: stateOf(c.state),
      source: sourceWord(c.source),
      sourceKey: c.source?.label || null,
      provider: c.source?.provider || null,
      observed: c.source?.observed_on || null,
      record: c.source?.record ?? null,
      needs: needsYou(c),
      note: c.note || null,
      noteOutdated: c.note_outdated === true,
      candidates: Array.isArray(c.candidates) ? c.candidates : null,
      raw: c,
    }))
    .sort((a, b) => Number(b.needs) - Number(a.needs) || a.state.rank - b.state.rank || a.section.localeCompare(b.section) || a.figure.localeCompare(b.figure));
}

/** The filter choices for State, Source and Section, each with its count, from the rows themselves. */
export function claimFilters(rows) {
  const count = (pick) => {
    const m = new Map();
    for (const r of rows) { const [k, l] = pick(r); const e = m.get(k) || { key: k, label: l, n: 0 }; e.n += 1; m.set(k, e); }
    return [...m.values()];
  };
  return {
    state: count((r) => [r.state.key, r.state.label]).sort((a, b) => stateOf(a.key).rank - stateOf(b.key).rank),
    source: count((r) => [r.sourceKey || 'none', r.source]),
    section: count((r) => [r.sectionKey, r.section]).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** The rows a filter leaves; `needsFirst` keeps only what needs the founder. */
export function filterClaims(rows, { state = 'all', source = 'all', section = 'all', needsFirst = false } = {}) {
  return rows.filter((r) => (state === 'all' || r.state.key === state)
    && (source === 'all' || (r.sourceKey || 'none') === source)
    && (section === 'all' || r.sectionKey === section)
    && (!needsFirst || r.needs));
}

/**
 * The 100% bar of claims by best source. A claim with no record is its own
 * dashed segment, "No record", never folded into a source. Widths add to 100.
 */
export function sourceBar(rows) {
  const total = rows.length;
  if (!total) return [];
  const parts = [...SOURCES.map((s) => ({ key: s.key, label: s.label, n: rows.filter((r) => r.sourceKey === s.key).length, dashed: false })),
    { key: 'none', label: 'No record', n: rows.filter((r) => !r.sourceKey).length, dashed: true }]
    .filter((p) => p.n > 0);
  let used = 0;
  return parts.map((p, i) => {
    const pct = i === parts.length - 1 ? 100 - used : Math.round((p.n / total) * 100);
    used += pct;
    return { ...p, pct };
  });
}

/** The line over the table: how many claims, how many need the founder. */
export function claimsLine(rows) {
  if (!rows.length) return '';
  const need = rows.filter((r) => r.needs).length;
  return `${rows.length} claim${rows.length === 1 ? '' : 's'} · ${need ? `${need} need${need === 1 ? 's' : ''} you` : 'none needs you'}`;
}

/** When the version was last checked, or that it never was. */
export function lastChecked(read) {
  const at = read?.checked_at;
  return at ? `Last checked ${String(at).replace('T', ' ').slice(0, 16)}` : 'Not checked yet';
}

/**
 * NAR8's summary: counts by state, or "Nothing compared yet." when no figure
 * was compared. A version with no claim compared nothing; it is never "no mismatch".
 */
export function checkLine(rows) {
  if (!rows.length) return 'Nothing compared yet.';
  return STATES.map((s) => [s, rows.filter((r) => r.state.key === s.key).length])
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s.label.toLowerCase()}`).join(' · ');
}

/** The lightbox's content for one claim: Not backed lists records that could back it; Mismatch shows both figures. */
export function claimSheet(row, version, search = '') {
  if (!row) return null;
  const story = `${HOME_PATH}/story${tabSearch(search, version)}`;
  const evidence = `/raise/evidence/claim/${encodeURIComponent(row.id)}`;
  if (row.state.key === 'mismatch') {
    return {
      kind: 'mismatch',
      title: `${row.figure} · Mismatch`,
      sub: 'Both figures with their sources. Neither is presumed right.',
      stated: { value: row.stated, where: `The narrative, v${version}, ${row.section}` },
      record: row.record != null ? { value: row.record, where: [row.source, row.provider, row.observed].filter(Boolean).join(' · ') } : null,
      useRecord: row.record != null ? story : null,
      canNote: row.record != null,
      note: row.note,
      noteOutdated: row.noteOutdated,
    };
  }
  if (row.state.key === 'not_backed') {
    return {
      kind: 'not_backed',
      title: `${row.figure} · Not backed`,
      sub: 'No pinned record backs this figure. These records in your Evidence pack could back it.',
      candidates: row.candidates,
      evidence,
    };
  }
  return { kind: 'state', title: `${row.figure} · ${row.state.label}`, sub: row.state.key === 'founders_figure' ? 'Only a figure you typed agrees with this one.' : 'A record agrees with this figure.', evidence };
}

/** The scope key Phrase the fix runs on: the venture and the claim clicked (`narrativeFix.ts`'s `fixScope`). */
export const fixScopeKey = (projectId, claimId) => `${Number(projectId)}|${claimId}`;

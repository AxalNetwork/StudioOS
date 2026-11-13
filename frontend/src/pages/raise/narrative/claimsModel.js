/**
 * D912 (#2696, part 6 of #2454) — Claims (NAR6, NAR7) and the check (NAR8,
 * NAR9): their words and derivations, with no React.
 *
 * Every state is the Worker's (D1264's claim check). A claim with no record
 * has no best source and is drawn as the bar's dashed Not backed segment. A
 * check with nothing compared reads "Nothing compared yet.", never "no
 * mismatch". Eadwyn's fix carries no number: the figures under it come from
 * the check.
 */
import { STATE_LABELS, STATE_TONE } from '../pitch/checkModel.js';

export { STATE_LABELS, STATE_TONE };

export const CLAIM_STATES = ['mismatch', 'not_backed', 'founders_figure', 'backed'];
export const SOURCE_ORDER = ['connector', 'signed', 'document', 'recorded', 'typed'];
export const SOURCE_LABELS = { connector: 'Connector', signed: 'Signed', document: 'Document', recorded: 'Recorded', typed: 'Typed', not_backed: 'Not backed' };
const PROVIDER = { stripe: 'Stripe', mercury: 'Mercury', hubspot: 'HubSpot', carta: 'Carta' };

export const NOTHING_COMPARED = 'Nothing compared yet.';
export const NO_CLAIMS = 'This version states no figure the check reads.';
export const NO_RECORDS = 'No record in your Evidence pack could back this figure yet. Pin one on Evidence, or keep it as your figure.';
export const CLAIMS_UNREADABLE = 'The claims could not be read. This is not a claim that there are none.';
export const SOURCE_UNREADABLE = 'The check could not read its sources. Nothing was changed; try again.';
export const FIX_NO_NUMBER = 'Eadwyn’s wording carries no number. The figures under it come from the check, and accepting changes the narrative only.';
export const FIX_SEPARATOR = '\n\nAs the check found them: ';
export const RESULT_LABELS = { ok: 'OK', mismatch: 'Mismatch', not_compared: 'Not compared' };
export const RESULT_TONE = { ok: 'ok', mismatch: 'warn', not_compared: 'neutral' };

/** Who holds a record: the provider's name, else its source label. */
export function recordSource(record) {
  if (!record) return null;
  return PROVIDER[String(record.provider || '').toLowerCase()] || (record.provider ? String(record.provider) : SOURCE_LABELS[record.source_label] || 'the record');
}

/** "Needs you first": Mismatch, then Not backed, then Founder's figure, then Backed. */
const rank = (s) => { const i = CLAIM_STATES.indexOf(s); return i < 0 ? 9 : i; };

/** The table's rows under its filters; `needsFirst` orders by what needs the founder. */
export function filterClaims(claims, { state = '', source = '', section = '', needsFirst = true } = {}) {
  const rows = (claims || []).filter((c) => (!state || c.state === state)
    && (!source || (source === 'not_backed' ? c.best_source == null : c.best_source === source))
    && (!section || c.section === section));
  return needsFirst ? [...rows].sort((a, b) => rank(a.state) - rank(b.state)) : rows;
}

/** The sections the claims fall in, in the order first met, for the Section filter. */
export function sectionOptions(claims) {
  const seen = new Map();
  for (const c of claims || []) if (c.section && !seen.has(c.section)) seen.set(c.section, c.section_label || c.section);
  return [...seen].map(([id, label]) => ({ id, label }));
}

/**
 * The 100% bar of claims by best source: one segment per source with any
 * claim, Not backed last and dashed. The shares are whole percents that add
 * to 100 (largest remainder). No claims, no bar.
 */
export function sourceBar(bySource) {
  const keys = [...SOURCE_ORDER, 'not_backed'];
  const counts = keys.map((k) => ({ key: k, n: Number(bySource?.[k]) || 0 })).filter((x) => x.n > 0);
  const total = counts.reduce((t, x) => t + x.n, 0);
  if (!total) return null;
  const raw = counts.map((x) => ({ ...x, exact: (x.n / total) * 100 }));
  const floors = raw.map((x) => ({ ...x, pct: Math.floor(x.exact) }));
  let left = 100 - floors.reduce((t, x) => t + x.pct, 0);
  [...floors].sort((a, b) => (b.exact - b.pct) - (a.exact - a.pct)).forEach((x) => { if (left > 0) { x.pct += 1; left -= 1; } });
  return {
    total,
    segments: floors.map((x) => ({ key: x.key, label: SOURCE_LABELS[x.key], n: x.n, pct: x.pct, dashed: x.key === 'not_backed' })),
    summary: `Claims by best source: ${floors.map((x) => `${SOURCE_LABELS[x.key]} ${x.n}`).join(', ')}.`,
  };
}

/** What a claim's drawer says first. */
export function claimLine(c) {
  if (c.state === 'mismatch' && c.record) {
    return `${c.section_label || 'The narrative'} says ${c.stated_shown ?? 'a figure'}. ${recordSource(c.record)} says ${c.record.shown ?? 'another'}${c.record.observed_on ? ` as of ${c.record.observed_on}` : ''}. Neither figure is presumed right.`;
  }
  if (c.state === 'not_backed') return 'No pinned record measures this figure yet.';
  if (c.state === 'founders_figure') return 'Only a figure you typed agrees with it. It is your figure, not backed by a record.';
  if (c.state === 'backed' && c.record) return `Backed by ${recordSource(c.record)}${c.record.observed_on ? `, as of ${c.record.observed_on}` : ''}.`;
  return '';
}

/** One record as a line: its source, provider and date. */
export function itemLine(item) {
  if (!item) return '';
  const who = PROVIDER[String(item.provider || '').toLowerCase()] || item.provider;
  return [SOURCE_LABELS[item.source_label] || item.source_label, who, item.observed_on].filter(Boolean).join(' · ');
}

/** NAR8's line over the table. */
export function checkLine(view) {
  if (!view || !Array.isArray(view.rows)) return null;
  if (!view.compared) return NOTHING_COMPARED;
  return `${view.compared} compared · ${view.mismatches} ${view.mismatches === 1 ? 'mismatch' : 'mismatches'}${view.rows.length > view.compared ? ` · ${view.rows.length - view.compared} not compared` : ''}`;
}

/** Which sides the version is checked against, in words. */
export function againstLine(view) {
  const a = view?.against || [];
  if (!a.length) return 'Check against: nothing chosen, so nothing is compared.';
  const deck = a.includes('deck') ? (view.deck?.version ? `Pitch deck v${view.deck.version}` : 'the pitch deck (none yet)') : null;
  return `Check against: ${[deck, a.includes('metrics') ? 'the metrics' : null].filter(Boolean).join(' and ')}.`;
}

/** The scope a fix is asked for: the venture, the version and the figure clicked. */
export const fixScope = (projectId, version, figure) => `${projectId}:v${version}:${figure}`;

/** A kept fix: Eadwyn's wording, and the check's own sentence under it. */
export function fixParts(body) {
  const s = String(body || '');
  const i = s.indexOf(FIX_SEPARATOR);
  return i < 0 ? { wording: s.trim(), found: null } : { wording: s.slice(0, i).trim(), found: s.slice(i + FIX_SEPARATOR.length).trim() };
}

export const FIX_PROPOSAL_NOTE = 'Proposed by Eadwyn for the mismatch you chose. Accept adds this wording to the section: change the sentence it fixes, then Save version.';

/** The section's words with an accepted fix added after them. */
export function appendFix(body, wording) {
  const a = String(body || '').trim();
  const b = String(wording || '').trim();
  return a ? (b ? `${a}\n\n${b}` : a) : b;
}

/** The Story address that places a fix as a proposal in its section. */
export function acceptFixHref(search, version, section, uid) {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = new URLSearchParams();
  const project = from.get('project_id') || from.get('project');
  if (project) out.set('project_id', project);
  out.set('version', String(version));
  if (section) out.set('section', section);
  out.set('fix', uid);
  return `/raise/investor-narrative/story?${out}`;
}

/** "Last checked …", or Not checked. */
export function lastChecked(at) {
  if (!at) return 'Not checked';
  const d = new Date(String(at).replace(' ', 'T') + (String(at).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return 'Not checked';
  return `Last checked ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`;
}

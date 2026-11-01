/**
 * D900 (#2679, part 6 of #2434) — the deck's check (PD13, PD2's pills and the
 * versions' Checks column): its words, with no React.
 *
 * Each figure's state is the Worker's (D1264's claim check, plus Stale from
 * the version's bindings). A version never checked is "Not checked", never a
 * row of zeros; a Mismatch names both figures and both sources and presumes
 * neither right.
 */

export const STATE_ORDER = ['backed', 'founders_figure', 'mismatch', 'not_backed', 'stale'];
export const STATE_LABELS = {
  backed: 'Backed',
  founders_figure: 'Founder’s figure',
  mismatch: 'Mismatch',
  not_backed: 'Not backed',
  stale: 'Stale',
};
/** The pill tone each state draws with. */
export const STATE_TONE = { backed: 'ok', founders_figure: 'info', mismatch: 'warn', not_backed: 'neutral', stale: 'warn' };

export const NOT_CHECKED = 'Not checked';
export const NO_FIGURES = 'No figures';
export const CHECK_INTRO = 'Each figure on this version against your pinned evidence. Nothing is changed until you choose.';
export const DIRTY_FIRST = 'Save or discard your changes first: using the record’s figure saves a new version.';
export const STALE_LINE = 'The record behind this card changed since it was bound. Refresh it from Sources, or keep it as of its date.';
export const NOT_BACKED_LINE = 'No pinned evidence measures this figure yet. Pin a record on Evidence, or leave it as your figure.';
export const FOUNDERS_LINE = 'Only a figure you typed agrees with it. It is your figure, not backed by a record.';
export const NEITHER_RIGHT = 'Neither figure is presumed right.';

const SOURCE = { connector: 'Connector', signed: 'Signed', document: 'Document', recorded: 'Recorded', typed: 'Typed' };
const PROVIDER = { stripe: 'Stripe', mercury: 'Mercury', hubspot: 'HubSpot', carta: 'Carta', github: 'GitHub', quickbooks: 'QuickBooks', xero: 'Xero' };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Who holds the record: the provider's name, else its source label. */
export function recordSource(record) {
  if (!record) return null;
  const p = String(record.provider || '').toLowerCase();
  return PROVIDER[p] || (record.provider ? String(record.provider) : SOURCE[record.source_label] || 'the record');
}

/** "Use Stripe’s figure", the canvas's words. */
export const useRecordLabel = (record) => `Use ${recordSource(record)}’s figure`;

/** "12 figures: 9 Backed, 1 Mismatch …", states with none left out. */
export function summaryLine(counts, figures) {
  if (!counts || !Number.isInteger(figures)) return null;
  if (figures === 0) return 'This version states no figure the check reads.';
  const parts = STATE_ORDER.filter((s) => Number(counts[s]) > 0).map((s) => `${counts[s]} ${STATE_LABELS[s]}`);
  return `${plural(figures, 'figure')}: ${parts.join(', ')}`;
}

/** The pills for a version's counts, in the canvas's order; none for a state with no figure. */
export function checkPills(counts) {
  if (!counts) return [];
  return STATE_ORDER.filter((s) => Number(counts[s]) > 0).map((s) => ({ key: s, label: `${counts[s]} ${STATE_LABELS[s]}`, tone: STATE_TONE[s] }));
}

/** The versions table's Checks cell for one version's summary (`GET /api/decks/checks`). */
export function checksCell(summary) {
  if (!summary) return NOT_CHECKED;
  if (!summary.checked) return NOT_CHECKED;
  const pills = checkPills(summary.counts);
  return pills.length ? pills.map((p) => p.label).join(' · ') : NO_FIGURES;
}

/** Each version's summary by deck id; a failed read is null, so the cells say so rather than "Not checked". */
export function checksByDeck(read) {
  if (!read || !Array.isArray(read.versions)) return null;
  return new Map(read.versions.map((v) => [Number(v.deck_id), v]));
}

/** What a claim's row says under its figure. */
export function claimLine(c) {
  if (c.display_state === 'stale') return STALE_LINE;
  if (c.state === 'mismatch' && c.record) {
    return `Card ${c.slide ?? '?'} says ${c.stated_shown ?? 'a figure'}. ${recordSource(c.record)} says ${c.record.shown ?? 'another'}${c.record.observed_on ? ` as of ${c.record.observed_on}` : ''}. ${NEITHER_RIGHT}`;
  }
  if (c.state === 'mismatch') return `This figure differs from the record. Run the check to see both figures. ${NEITHER_RIGHT}`;
  if (c.state === 'not_backed') return NOT_BACKED_LINE;
  if (c.state === 'founders_figure') return FOUNDERS_LINE;
  if (c.state === 'backed' && c.record) return `Backed by ${recordSource(c.record)}${c.record.observed_on ? `, as of ${c.record.observed_on}` : ''}.`;
  return '';
}

/** Mismatches first, then the rest by card. */
export function sortClaims(claims) {
  const rank = (c) => (c.display_state === 'mismatch' ? 0 : c.display_state === 'stale' ? 1 : c.display_state === 'not_backed' ? 2 : 3);
  return [...(claims || [])].sort((a, b) => rank(a) - rank(b) || (a.slide ?? 0) - (b.slide ?? 0));
}

/** "Last checked 27 Oct 2026, 14:05", or Not checked. */
export function lastChecked(at) {
  if (!at) return NOT_CHECKED;
  const d = new Date(String(at).replace(' ', 'T') + (String(at).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return NOT_CHECKED;
  return `Last checked ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`;
}

/** A refusal in our words: the Worker's sentence when it gave one. */
export function refusalText(e, fallback) {
  const m = typeof e?.message === 'string' ? e.message.trim() : '';
  return m || fallback;
}

/**
 * #3657: who runs the check is the check read's answer (`can_check`, D900),
 * never the editor's write access: HQ may edit a deck (#3637) yet the Worker
 * keeps the check the venture founder's. Unknown (not yet read, or the read
 * failed) is no.
 */
export const mayRunCheck = (data, readOnly) => !readOnly && data?.can_check === true;

/** The Worker's refusal for anyone but the venture's founder. */
export const isFounderOnly = (e) => e?.code === 'founder_only' || e?.data?.error === 'founder_only';

export const NOTE_MAX = 500;
/** A note's text, or the reason it cannot be saved. */
export function checkNote(text) {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'Say why you keep your figure.' };
  if (t.length > NOTE_MAX) return { error: `A note is at most ${NOTE_MAX} characters.` };
  return { note: t };
}

// ------------------------------------------------- D1555 (#3802): Consistency · free

export const CONSISTENCY_TITLE = 'Consistency · free';
export const CONSISTENCY_EMPTY = 'Every figure is linked and consistent.';
export const CONSISTENCY_FAILED = 'Could not be read.';

/**
 * What the Consistency section draws from the check reply's `consistency`:
 *   'none'        the reply carries no section (a reader who is not the founder);
 *   'unreadable'  the rules could not read this version's cards (Try again);
 *   'empty'       every rule passed;
 *   'findings'    one row per finding, its cards in order.
 * A missing or malformed answer is unreadable, never "consistent".
 */
export function consistencyView(c) {
  if (c === null || c === undefined) return { kind: 'none', rows: [] };
  if (c?.state !== 'ok' || !Array.isArray(c.findings)) return { kind: 'unreadable', rows: [] };
  const rows = c.findings
    .filter((f) => f && typeof f.message === 'string' && Array.isArray(f.cards))
    .map((f) => ({ key: String(f.key ?? f.message), message: f.message, cards: f.cards.filter((n) => Number.isInteger(n) && n > 0) }));
  return rows.length ? { kind: 'findings', rows } : { kind: 'empty', rows: [] };
}

/** "card 2", "cards 1 and 3". */
export const cardsLabel = (cards) => (cards.length === 1 ? `card ${cards[0]}` : `cards ${cards.slice(0, -1).join(', ')} and ${cards.at(-1)}`);

/**
 * D1583 (#3830, deck builder v2 F4) — the words and rules of ⋯ › This deck ›
 * "Teaser, one-pager or memo…" and of its proposals in Ask. Pure: no React,
 * no request.
 *
 *   DERIVE_FORMATS   the three outputs, each with its one line
 *   DERIVE_ASK_OPTIONS the rail options Ask lists them under
 *   derivedProposal  a waiting proposal, read from its rail row, or null
 *   deriveHold       the memo's quote as "Holds up to $x · you pay what it uses"
 *
 * The owner's rules this file carries: a derived output is a proposal until
 * Accept, and Accept stores it (never the generic decide); the teaser and the
 * one-pager are free and say so; the memo shows its hold before it runs; a
 * blind output names no one and carries no data room.
 */
import { HOLD } from './deckV2Model.js';
import { aiTokens } from './newDeckModel.js';

export const DERIVE_FORMATS = Object.freeze([
  { id: 'teaser', label: 'Teaser', line: 'The cover and the sections an investor reads first, up to six cards.', ai: false },
  { id: 'one_pager', label: 'One-pager', line: 'One page with your figures and a line per section.', ai: false },
  { id: 'memo', label: 'Memo', line: 'An investment memo written from this version. Every figure in it is one your deck states.', ai: true },
]);
export const FORMAT_LABELS = Object.freeze({ teaser: 'Teaser', one_pager: 'One-pager', memo: 'Memo' });
export const DERIVE_ASK_OPTIONS = Object.freeze(['derive:teaser', 'derive:one_pager', 'derive:memo']);
const FORMAT_OF = Object.freeze({ 'derive:teaser': 'teaser', 'derive:one_pager': 'one_pager', 'derive:memo': 'memo' });

export const DERIVE_TITLE = 'Teaser, one-pager or memo';
export const BLIND_LABEL = 'Blind';
export const BLIND_LINE = 'No company or founder name, no logo or photo, no team card and no data room link.';
export const FREE_LINE = 'No model · free';
export const PROPOSED_LINE = 'Proposed. It waits in Ask until you accept it; nothing is kept before then.';
export const DERIVED_SECTION = 'Teasers, one-pagers and memos';

/** The memo's hold, or the free line; null while the quote reads or when it could not be read. */
export function deriveHold(format, quote) {
  if (format !== 'memo') return FREE_LINE;
  if (!quote || quote.ai !== true || !Number.isFinite(Number(quote.hold_microusd))) return null;
  return HOLD(aiTokens(Number(quote.hold_microusd)));
}

/** A derive proposal waiting on this deck version, or null when the row is not one. */
export function derivedProposal(row, deckId) {
  if (!row || row.status !== 'proposed') return null;
  const format = FORMAT_OF[row.rail_option];
  if (!format || row.record_ref !== `deck:${deckId}`) return null;
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const cards = Array.isArray(p.cards) ? p.cards.filter((t) => typeof t === 'string') : [];
  const summary = format === 'memo'
    ? (typeof p.memo === 'string' ? p.memo.replace(/^##.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180) : '')
    : cards.length ? `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}: ${cards.join(' · ')}` : '';
  return { uid: row.uid, format, blind: p.blind === true, title: typeof p.title === 'string' && p.title ? p.title : DERIVE_FORMATS.find((f) => f.id === format).label, summary, at: row.created_at ?? null };
}

/**
 * D1261 (#2430) — Raise evidence, from the owner's canvas "Raise evidence"
 * (VR1–VR19): the founder's Evidence view at `/raise/evidence` with its item and
 * claim drawers as addresses, the five Source labels (the platform's one Source
 * vocabulary), the three strengths, the claim states, the three sharing levels,
 * the Raise areas the pack covers, and the words of every block no read carries
 * yet. Pure, so `frontend/test/raise_evidence_d1261.test.mjs` holds each rule.
 *
 * NOTHING IS READ HERE YET. `raise_evidence_items`, `raise_claims` and the
 * candidate builder are part 2; the claim check part 3; the investor read part
 * 4. Each label's default grade is SCORING's one mapping
 * (`components/scoring/scorecard/scorecardModel.js` SOURCE_GRADE); this file
 * adds no grade of its own.
 */
import { SOURCE_GRADE } from '../../../components/scoring/scorecard/scorecardModel.js';

export const BASE = '/raise/evidence';
export const TITLE = 'Evidence';
export const PAGE_LINE = 'What backs each claim you make to investors, where it came from, and who can see it.';

/** The five Source labels, set by code from the record, never by the founder or Eadwyn. */
export const SOURCES = Object.freeze([
  { key: 'connector', label: 'Connector', shown: 'as of the fact’s own date' },
  { key: 'document', label: 'Document', shown: 'the file, opened by the data room’s rules' },
  { key: 'recorded', label: 'Recorded', shown: 'the session and the moment it was heard' },
  { key: 'signed', label: 'Signed', shown: 'the date it was signed or filed' },
  { key: 'typed', label: 'Typed', shown: 'who entered it, and when' },
]);
export const gradeOf = (sourceKey) => SOURCE_GRADE[sourceKey] || null;

/** Strength stays separate from the Source and never sets a grade. */
export const STRENGTHS = Object.freeze(['anecdote', 'pattern', 'measured']);
export const strengthWord = (s) => (STRENGTHS.includes(s) ? `Strength: ${s}` : null);

/** A claim's state. Typed-only backing is the founder's figure, never Backed. */
export const CLAIM_STATE = Object.freeze({
  backed: 'Backed',
  founders_figure: 'Founder’s figure',
  mismatch: 'Mismatch',
  not_backed: 'Not backed',
});
export const claimWord = (s) => CLAIM_STATE[s] || 'Not checked yet';

/** Who sees an item. */
export const SHARING = Object.freeze({
  private: 'Private',
  summary: 'Summary',
  after_nda: 'After NDA',
});

/** The Raise areas the pack covers, in the canvas's order. */
export const AREAS = Object.freeze([
  'Fundraising readiness', 'Investor narrative and Pitch deck', 'Use of funds', 'Data room',
  'Cap table', 'Capital relationships', 'Legal', 'Capital model',
]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the address names: the page, or one item's or one claim's drawer over it. */
export function viewOf(pathname = '') {
  const rest = String(pathname).startsWith(BASE) ? String(pathname).slice(BASE.length) : '';
  const m = /^\/(item|claim)\/([^/]+)\/?$/.exec(rest);
  if (m && ID.test(m[2])) return { drawer: m[1], id: m[2] };
  return { drawer: null, id: null };
}
export const itemHref = (id, search = '') => (ID.test(String(id ?? '')) ? `${BASE}/item/${id}${search}` : `${BASE}${search}`);
export const claimHref = (id, search = '') => (ID.test(String(id ?? '')) ? `${BASE}/claim/${id}${search}` : `${BASE}${search}`);

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  claims: 'Each claim’s state, the evidence behind it and its source are not read here yet: the stores and candidate builder are part 2, the claim check part 3.',
  proposals: 'Evidence waiting for your review (the candidates built from Validate, Build and connectors) is not read here yet (part 2).',
  coverage: 'Coverage by area and by source is not read here yet (part 2).',
  opens: 'Which investors opened what is not recorded yet (part 4).',
  item: 'This item, its record, its date and its sharing are not read here yet (part 2).',
  claim: 'This claim, its state and the evidence linked to it are not read here yet (part 3).',
  investor: 'The founder’s shared evidence is not read here yet: the investor read, its NDA rule and its log are part 4. Until it lands, nothing a founder has not shared is shown.',
});

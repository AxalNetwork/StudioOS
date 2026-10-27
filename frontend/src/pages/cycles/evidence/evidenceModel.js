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
});

// ---------------------------------------------------------------------------
// D1268 (#3291) — the investor's read (D1265 `investorEvidence`): VR8 before the
// NDA, VR9 after it, VR10 one item. The read already holds back every private
// item, every bank line, every unconsented quote, every refused file and one
// investor's money; this model draws only what it returned and never adds a
// value the read did not carry.

/** Each evidence kind in words (`services/raiseEvidenceSources.ts` EVIDENCE_RULES). An unknown kind reads "Evidence". */
export const KIND_WORDS = Object.freeze({
  'revenue-receipt': 'Revenue receipts', 'bank-runway': 'Runway from the bank', 'founder-holding': 'Founder holdings',
  'vesting-schedule': 'Vesting schedules', 'founder-commits': 'Founder contributions', 'skill-actions': 'Recorded team actions',
  'pain-theme': 'Interview pain themes', 'consented-quote': 'Interview quotes', 'icp-fit': 'Interviews with an ICP fit',
  'demand-signal': 'Demand signals', 'experiment-result': 'Experiment results', 'validation-verdict': 'Validation decisions',
  'kpi-snapshot': 'Dated KPIs', 'bank-revenue': 'Revenue from the bank', 'roadmap-release': 'Releases',
  'must-have-done': 'Must-haves done', 'mapped-bank-spend': 'Spend from the bank, by section', 'hiring-plan': 'Planned hires',
  'roadmap-milestone': 'Roadmap milestones', 'formation-proof': 'Formation proof', 'filed-obligation': 'Filed obligations',
  'signed-document': 'Signed documents', 'github-ip-step': 'GitHub IP step', 'bank-statement': 'Bank statements',
  'loi-file': 'Letters of intent', 'revenue-proof': 'Revenue proof', 'accepted-safe': 'Accepted SAFEs', 'filed-83b': '83(b) filings',
  'signed-founder-equity': 'Founder and equity documents', 'confirmed-receipt': 'Confirmed receipts',
  'round-call-response': 'Round-call responses', 'typed-commitment': 'Stated commitments', 'model-assumption': 'Model assumptions',
});
export const kindWord = (k) => KIND_WORDS[k] || 'Evidence';
export const sourceWord = (key) => SOURCES.find((s) => s.key === key)?.label || 'Not recorded';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `3 Oct 2026` from the record's own date (`YYYY-MM-DD…`); null for anything else. */
export function recordDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Where an item came from, in one line: its Source label and, for a bank-derived figure, the company's bank (D1269), with the record's date. */
export function sourceLine(item) {
  const day = recordDay(item?.observed_on);
  const bank = item?.provider === 'mercury';
  const from = bank ? 'From the company’s bank' : sourceWord(item?.source_label);
  return day ? `${from}, as of ${day}` : `${from}, date not recorded`;
}

/** An item's figure as the read gave it, or null. Never a zero for a missing value. */
export function figureOf(item) {
  const n = item?.value_num;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const cur = item?.currency || '';
  const money = (v) => `${cur ? `${cur} ` : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  switch (item?.value_unit) {
    case 'cents': return money(n / 100);
    case 'money': return money(n);
    case 'percent': return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    case 'months': return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} months`;
    case 'people': return `${n.toLocaleString('en-US')} people`;
    case 'accounts': return `${n.toLocaleString('en-US')} accounts`;
    default: return n.toLocaleString('en-US');
  }
}

/** One block of the read (`coverage`, `items`, `claims`): its rows, or why there are none. */
const blockOf = (b) => (b && b.state === 'recorded' ? { ok: true, rows: Array.isArray(b.groups) ? b.groups : Array.isArray(b.rows) ? b.rows : [] }
  : { ok: false, reason: b?.reason || 'This evidence could not be read. Try again.' });

/**
 * What the investor block draws from one read:
 *   `none`        the read does not admit this reader (round call: `evidence: null`);
 *   `unreadable`  the whole read failed;
 *   `before`      no NDA yet: coverage only, never a value, an item or a claim;
 *   `after`       the NDA is signed: each shared item, its claim states, and coverage.
 */
export function investorView(read) {
  if (read == null) return { stage: 'none' };
  if (read.state === 'unreadable') return { stage: 'unreadable', reason: read.reason || 'The evidence could not be read. Try again.' };
  const coverage = blockOf(read.coverage);
  if (!read.nda_signed) return { stage: 'before', line: read.before_nda || 'Figures, files and quotes open once the NDA is signed.', coverage, partial: !!read.partial };
  const items = blockOf(read.items);
  const claims = blockOf(read.claims);
  const byItem = new Map();
  if (claims.ok) for (const c of claims.rows) for (const uid of c.items || []) byItem.set(uid, [...(byItem.get(uid) || []), c]);
  const rows = items.ok ? items.rows.map((i) => ({ ...i, figure: figureOf(i), claims: byItem.get(i.uid) || [] })) : [];
  const areas = AREAS.map((a) => [a, rows.filter((r) => r.area === a)]).filter(([, rs]) => rs.length);
  const withValue = rows.filter((r) => r.figure != null).length;
  return {
    stage: 'after', coverage, items: items.ok ? { ok: true, rows, areas } : items, claims, partial: !!read.partial,
    tally: items.ok ? `${rows.length} shared ${rows.length === 1 ? 'item' : 'items'}: ${withValue} with ${withValue === 1 ? 'its figure' : 'their figures'}, ${rows.length - withValue} without.` : null,
  };
}

/** A coverage tile: area, kind, Source, count and the newest date. No value. */
export const coverageTile = (g) => ({
  area: g.area, kind: kindWord(g.kind), source: sourceWord(g.source_label), count: Number.isSafeInteger(g.count) ? g.count : null,
  newest: recordDay(g.newest) ? `newest ${recordDay(g.newest)}` : 'date not recorded',
});

/** What the deal page says when the read is refused or fails (D1265 §4). */
export function refusalOf(error) {
  if (error?.status === 403 && (error?.code === 'investor_only' || error?.data?.code === 'investor_only')) return { kind: 'founder', line: 'This is the investor’s view. You read your evidence in Raise › Evidence.' };
  if (error?.status === 403 || error?.status === 404) return { kind: 'closed', line: 'The founder’s evidence is not open to you on this deal.' };
  return { kind: 'unreadable', line: 'The evidence could not be read. That is not the same as none.' };
}

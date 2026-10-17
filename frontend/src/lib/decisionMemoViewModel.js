/**
 * D693 (#1704, decision 11): the decision memo's content, built from Verdict's
 * record read (`GET /api/cycles/validate/modules/verdict/records/:id`, #1703)
 * and nothing else. Pure, so the PDF (`decisionMemoPdf.js`) and its tests read
 * the same model.
 *
 * An explicit allowlist, as `personaViewModel.js` is: the venture, the
 * decision and its state, the scope, the date and author, the reasoning, the
 * evidence it rests on, the commitments and what it supersedes. Activity and
 * actions never reach it. A list that does not fit the one page ends with
 * "<n> more in StudioOS", because a one-page PDF clips silently.
 */

/** Rows each list keeps on the page; the rest is counted, never dropped silently. */
export const MEMO_LIMITS = { evidence: 8, commitments: 6 };
/** The Worker's `DECISION_EVIDENCE_BAR`, which a Withheld memo names. */
const BAR = 5;

const line = (value, limit = 500) => {
  const plain = ['string', 'number'].includes(typeof value) ? String(value).replace(/\s+/g, ' ').trim() : '';
  const chars = Array.from(plain);
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : plain;
};
const sectionOf = (record, key) => [...(record?.main ?? []), ...(record?.side ?? [])].find((s) => s?.key === key) ?? null;
const factOf = (record, label) => (record?.facts ?? []).find((f) => f?.label === label) ?? null;
const factValue = (fact) => (fact?.value == null ? 'Not recorded' : line(fact.value, 200));

function list(section, limit, row) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const more = Math.max(0, rows.length - limit);
  return {
    rows: rows.slice(0, limit).map(row),
    more: more ? `${more} more in StudioOS` : null,
    empty: rows.length ? null : line(section?.empty, 200) || 'Nothing recorded.',
  };
}

export function decisionMemoModel(record, { venture = '', generatedAt = new Date() } = {}) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid generatedAt date is required.');
  const pills = (record?.pills ?? []).map((p) => line(typeof p === 'string' ? p : p?.text, 40));
  const status = pills[1] || '';
  const evidence = sectionOf(record, 'evidence');
  const checked = Array.isArray(evidence?.rows) ? evidence.rows.length : 0;
  const reasoning = sectionOf(record, 'reasoning');
  return {
    venture: line(venture, 120) || 'The venture',
    title: line(record?.title, 300) || 'Decision',
    sub: line(record?.sub, 300),
    decision: factValue(factOf(record, 'Decision')),
    status,
    withheld: status === 'Withheld' ? `Withheld: ${checked} of ${BAR} pieces of evidence` : null,
    scope: factValue(factOf(record, 'For')),
    supersedes: factValue(factOf(record, 'Supersedes')),
    supersedesReason: factOf(record, 'Supersedes')?.value == null ? line(factOf(record, 'Supersedes')?.reason, 200) : '',
    reasoning: line(reasoning?.rows?.[0]?.a, 1200) || line(reasoning?.empty, 200) || 'No reasoning recorded.',
    evidence: list(evidence, MEMO_LIMITS.evidence, (r) => ({ label: line(r?.a, 200), meta: line(r?.b, 80), direction: line(r?.c, 20) })),
    commitments: list(sectionOf(record, 'commitments'), MEMO_LIMITS.commitments, (r) => ({ label: line(r?.a, 300), meta: line(r?.b, 80) })),
    date: date.toISOString().slice(0, 10),
  };
}

/** `decision-memo-<venture slug>-<yyyy-mm-dd>.pdf`, the date being the day it was exported. */
export function decisionMemoFilename(model) {
  const slug = String(model?.venture ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '') || 'venture';
  return `decision-memo-${slug}-${model?.date}.pdf`;
}

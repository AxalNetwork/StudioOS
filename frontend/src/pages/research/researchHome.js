/**
 * D3701 (Research v2, #3701) part 2 — what the RS-01 Overview cards say, read
 * from stores the platform already has. Each card is one of four shapes, so
 * none of them can draw a zero it was not given:
 *
 *   { state: 'loading' }
 *   { state: 'unreadable' }            its own read failed; the card retries alone
 *   { state: 'not_recorded', reason }  no store holds this yet
 *   { state: 'ok', ... }               an empty list is `ok` with no rows
 *
 * WHAT IS NOT RECORDED. The canvas's Recent research projects and Saved briefs
 * are a Research Project and a sectioned brief, and neither object exists
 * (D3701 "Existing vs proposed"). Their cards say so instead of borrowing Ask
 * sessions or collections and calling them projects.
 *
 * WHAT IS. Continue where you left off is the newest Ask exchange
 * (`research_ask_answers`, scope `all`). Recently added evidence is the library,
 * newest first, with part 1's two states. Tracking is the founder's fund
 * shortlist (`research_funds`); markets and companies have no "track" store.
 */
import { answerabilityOf, indexStateOf } from './researchStates.js';

/** The three examples. They fill the question field; nothing runs until Start research. */
export const EXAMPLES = [
  'Analyze the European AI infrastructure market',
  'Compare three B2B SaaS companies',
  'Find seed funds investing in climate technology',
];

export const NOT_RECORDED_REASONS = {
  projects: 'Research projects are not stored yet. A project would hold one question with its evidence, findings and brief; until it exists, each Ask question stands on its own.',
  briefs: 'Briefs are not stored yet. Saved Ask answers are kept, with their citations, on the Ask page.',
  trackingOther: 'Markets and companies cannot be tracked yet; only the funds you add are kept.',
};

/** `read` is `{ status: 'loading' | 'failed' | 'ok', value }` for one request. */
const shell = (read) => {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'failed') return { state: 'unreadable' };
  return null;
};

/** The newest Ask exchange, or `ok` with nothing to continue. */
export function continueCard(read) {
  const early = shell(read);
  if (early) return early;
  const items = Array.isArray(read.value?.items) ? read.value.items : [];
  // `scope=all` is newest first (ORDER BY id DESC).
  const last = items[0];
  if (!last) return { state: 'ok', last: null };
  return {
    state: 'ok',
    last: {
      question: last.question || 'Untitled question',
      at: last.created_at || null,
      answered: last.reason === 'answered',
    },
  };
}

/** The newest `n` library documents, each with both of part 1's states. */
export function evidenceCard(read, n = 3) {
  const early = shell(read);
  if (early) return early;
  const items = Array.isArray(read.value?.items) ? read.value.items : [];
  const rows = [...items]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, n)
    .map((d) => ({ uid: d.uid, title: d.title || 'Untitled document', at: d.created_at || null, index: indexStateOf(d), answer: answerabilityOf(d) }));
  return { state: 'ok', rows, total: items.length };
}

/** The funds the founder has added; markets and companies are named as not tracked. */
export function trackingCard(read) {
  const early = shell(read);
  if (early) return early;
  const items = Array.isArray(read.value?.items) ? read.value.items : [];
  return {
    state: 'ok',
    chips: items.filter((f) => f && f.name).map((f) => ({ key: f.uid || f.name, label: `Fund · ${f.name}`, to: f.uid ? `/research/funds/${encodeURIComponent(f.uid)}` : '/research/funds' })),
    other: NOT_RECORDED_REASONS.trackingOther,
  };
}

export const projectsCard = () => ({ state: 'not_recorded', reason: NOT_RECORDED_REASONS.projects });
export const briefsCard = () => ({ state: 'not_recorded', reason: NOT_RECORDED_REASONS.briefs });

/** A date for a card line, or Not recorded. Never today's date for a missing one. */
export function shortDate(value) {
  if (!value) return 'Date not recorded';
  const d = new Date(String(value).includes('T') || String(value).endsWith('Z') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return 'Date not recorded';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

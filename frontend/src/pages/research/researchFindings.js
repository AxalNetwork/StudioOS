/**
 * D5157 part 2 (#5157) — what a Research Project's Findings tab and the
 * Overview's Most recent findings say, read from the findings store
 * (`routes/research_project_findings.ts`). Pure, so the page and the tests
 * read the same words.
 *
 * THE KIND IS A WORD, ALWAYS FIRST (RS-B FindingCard; RS-C "finding kinds are
 * words, not tints"): Source fact, Eadwyn interpretation, Your conclusion.
 *
 * WHAT IS RECORDED. An interpretation is accepted, edited or discarded; until
 * then it is a proposal (one of the project's Ask answers) and reads Needs
 * review. Freshness, Flagged and Conflicting have no store, so no finding is
 * ever put in them. A citation's source is available, removed (only the
 * passage recorded with it remains) or not recorded (an old Ask citation that
 * never named its document).
 */
import { NOT_RECORDED, answerabilityOf, indexStateOf } from './researchStates.js';

/** The Worker's limit on typed finding text. */
export const FINDING_TEXT_LIMIT = 4000;

export const FINDING_KIND = {
  source_fact: { label: 'Source fact', chip: 'Source facts' },
  interpretation: { label: 'Eadwyn interpretation', chip: 'Eadwyn' },
  conclusion: { label: 'Your conclusion', chip: 'Yours' },
};
export const kindOf = (k) => FINDING_KIND[k] || { label: NOT_RECORDED, chip: NOT_RECORDED };

/** An interpretation's state, in words with a glyph so colour never carries it alone. */
export const INTERPRETATION_STATE = {
  proposed: { label: 'Needs review', tone: 'warn', glyph: '!' },
  accepted: { label: 'Accepted', tone: 'ok', glyph: '✓' },
  edited: { label: 'Edited by you', tone: 'ok', glyph: '✎' },
  discarded: { label: 'Discarded', tone: 'neutral', glyph: '×' },
};

export const CITATION_AVAILABILITY = {
  available: { label: 'Available', tone: 'ok', glyph: '✓' },
  removed: { label: 'Source removed', tone: 'neutral', glyph: '?' },
  not_recorded: { label: 'Source not recorded', tone: 'neutral', glyph: '?' },
};
export const availabilityOf = (c) => CITATION_AVAILABILITY[c?.availability] || { label: NOT_RECORDED, tone: 'neutral', glyph: '?' };

/** The filter chips, in the canvas's order; Flagged has no store and is not drawn. */
export const FINDING_FILTERS = [
  { slug: 'all', label: 'All' },
  { slug: 'source_fact', label: 'Source facts' },
  { slug: 'interpretation', label: 'Eadwyn' },
  { slug: 'conclusion', label: 'Yours' },
  { slug: 'discarded', label: 'Discarded' },
];

/** `read` is `{ status: 'loading' | 'failed' | 'not_found' | 'ok', value }`. */
export function findingsState(read) {
  if (!read || read.status === 'loading') return 'loading';
  if (read.status === 'ok') return 'ok';
  return 'unreadable';
}

/** One card: a stored finding, or a proposal drawn from an Ask answer. */
function cardOf(f) {
  const proposal = f.answer_uid !== undefined && f.kind === undefined;
  const kind = proposal ? 'interpretation' : f.kind;
  const state = proposal ? 'proposed' : f.kind === 'interpretation' ? f.state : null;
  return {
    key: proposal ? `proposal-${f.answer_uid}` : f.uid,
    uid: proposal ? null : f.uid,
    answerUid: f.answer_uid || null,
    proposal,
    kind,
    kindWord: kindOf(kind),
    state: state ? (INTERPRETATION_STATE[state] || { label: NOT_RECORDED, tone: 'neutral', glyph: '?' }) : null,
    stateSlug: state,
    text: f.text || '',
    // Eadwyn's own words, shown beside an edit so the change is visible.
    proposedText: !proposal && f.kind === 'interpretation' && f.state === 'edited' ? (f.proposed_text || null) : null,
    question: proposal ? (f.question || null) : null,
    citations: Array.isArray(f.citations) ? f.citations : [],
    when: f.decided_at || f.created_at || null,
    // Only your own words are edited or deleted as text.
    editable: !proposal && f.kind === 'conclusion',
    deletable: !proposal && (f.kind === 'conclusion' || f.kind === 'source_fact'),
    decidable: proposal || f.kind === 'interpretation',
  };
}

/** The tab's cards and chip counts. Proposals come first: they wait on you. */
export function findingsView(read, filter = 'all') {
  const state = findingsState(read);
  if (state !== 'ok') return { state };
  const value = read.value || {};
  const items = (Array.isArray(value.items) ? value.items : []).filter((f) => f && f.uid).map(cardOf);
  const proposals = (Array.isArray(value.proposals) ? value.proposals : []).filter((p) => p && p.answer_uid).map((p) => cardOf({ ...p, kind: undefined }));
  const all = [...proposals, ...items];
  const live = all.filter((c) => c.stateSlug !== 'discarded');
  const counts = {
    all: live.length,
    source_fact: live.filter((c) => c.kind === 'source_fact').length,
    interpretation: live.filter((c) => c.kind === 'interpretation').length,
    conclusion: live.filter((c) => c.kind === 'conclusion').length,
    discarded: all.length - live.length,
  };
  const pick = filter === 'discarded' ? all.filter((c) => c.stateSlug === 'discarded')
    : filter === 'all' ? live
    : live.filter((c) => c.kind === filter);
  return {
    state,
    counts,
    cards: pick,
    proposals: proposals.length,
    passages: Array.isArray(value.passages) ? value.passages : [],
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    empty: all.length === 0,
  };
}

/** RS-02's Most recent findings: the newest kept findings, and what waits on review. */
export function recentFindings(read, n = 2) {
  const view = findingsView(read);
  if (view.state !== 'ok') return { state: view.state };
  return {
    state: 'ok',
    cards: view.cards.filter((c) => !c.proposal).slice(0, n),
    waiting: view.proposals,
    total: view.counts.all - view.proposals,
  };
}

/** The tab's badge: kept findings, or nothing while the read is not ok. */
export function findingsBadge(read) {
  const view = findingsView(read);
  return view.state === 'ok' ? view.counts.all - view.proposals : null;
}

/** The citation panel's lines, read from what the citation recorded. */
export function citationPanel(c) {
  const avail = availabilityOf(c);
  const live = c?.availability === 'available';
  return {
    n: c?.n ?? null,
    title: c?.title || 'Untitled document',
    availability: avail,
    year: live ? (c.source_year ?? null) : null,
    index: live ? indexStateOf({ index_state: c.index_state }) : null,
    answer: live ? answerabilityOf({ in_ask: c.in_ask }) : null,
    page: c?.page ?? null,
    passage: c?.passage || null,
    inEvidence: Boolean(c?.in_evidence),
    openHref: live && c.document_uid ? `/research/library#document-${encodeURIComponent(c.document_uid)}` : null,
    note: c?.availability === 'removed'
      ? 'This document is no longer in your Library, so only the passage recorded with this finding remains.'
      : c?.availability === 'not_recorded'
        ? 'This citation was recorded before Ask kept the document it came from, so its source cannot be opened.'
        : null,
  };
}

/** A form's check before it is sent; the Worker checks again. */
export function findingDraftErrors(draft) {
  const errors = {};
  const text = String(draft?.text ?? '').trim();
  if (!text) errors.text = draft?.kind === 'source_fact' ? 'Write the fact the passage states.' : 'Write your conclusion.';
  else if (text.length > FINDING_TEXT_LIMIT) errors.text = `Keep this under ${FINDING_TEXT_LIMIT} characters.`;
  if (draft?.kind === 'source_fact' && !draft?.passage) errors.passage = 'Choose the passage this fact stands on.';
  return errors;
}

/** The body a form sends. A passage is `answer_uid:n`; a document is its uid. */
export function findingDraftBody(draft) {
  const citations = [];
  if (draft?.passage) {
    const [answerUid, n] = String(draft.passage).split(':');
    citations.push({ answer_uid: answerUid, n: Number(n) });
  }
  for (const uid of draft?.documents || []) citations.push({ document_uid: uid });
  const body = { kind: draft?.kind, text: String(draft?.text ?? '').trim() };
  if (citations.length) body.citations = citations;
  return body;
}

/** The Worker's refusal codes in words; anything else is its own message. */
export const FINDING_ERRORS = {
  project_archived: 'This project is archived, so its findings cannot change until you restore it.',
  citation_not_in_project: 'That source is not in this project’s evidence any more.',
  passage_required: 'A source fact needs the passage it stands on.',
  text_unchanged: 'The edit is the same as Eadwyn’s words. Use Accept instead.',
  nothing_to_interpret: 'That Ask answer has no words to decide on.',
};
export const findingError = (err, fallback) => FINDING_ERRORS[err?.code] || err?.message || fallback;

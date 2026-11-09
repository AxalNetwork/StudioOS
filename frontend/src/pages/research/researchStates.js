/**
 * D3701 (Research v2, #3701) — the words, tones and glyphs for two questions
 * the canvas keeps apart on every surface: what the indexer did with a
 * document (RS-06 "Index state"), whether Ask may cite it (RS-06 "Answerable
 * in Ask"), and which of Ask's response states an exchange is in (RS-07C,
 * "never collapsed into one").
 *
 * WHY TWO COLUMNS. A document can be indexed and still not answerable: a file
 * a client opened to you is indexed in their namespace, which Ask never
 * searches for you. The Library used to put "Answerable" inside the index
 * state pill, so the two read as one fact and the canvas's own note ("Indexed
 * is not the same as answerable") had nothing to point at.
 *
 * WHAT IS RECORDED. `research_documents.index_state` is pending, indexed,
 * partial, unsupported or failed. The canvas's Uploading, Indexing and
 * Unavailable are proposed (D3701 "Existing vs proposed"), so there is no
 * label for them here. An index state this file does not know reads Not
 * recorded, never a guess.
 *
 * Ask's `reason` is answered, no_source, retrieval_unavailable or
 * model_unavailable. Two more of the canvas's seven come from what the page
 * already holds, not from a new field:
 *   · No answerable documents: the library read succeeded and nothing in it is
 *     answerable. That is the zero-source page (RS-07B), not a row state.
 *   · Source no longer available: an answer cites a document the library read
 *     no longer lists. It is only said when the library was read; an
 *     unreadable library never makes a citation look removed.
 * Insufficient evidence is proposed: the Worker has no outcome for "sources
 * touch the topic but do not support an answer", so no exchange is ever put in
 * it, and the entry below carries `proposed: true` so the page cannot draw it.
 */
// The one definition lives in `lib/absence.js` (absence_helpers_single_definition test).
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };

/** RS-06 "Index state": what the indexer did, in the indexer's words. */
export const INDEX_STATE = {
  indexed: { label: 'Indexed', tone: 'ok', glyph: '✓' },
  partial: { label: 'Partly indexed', tone: 'warn', glyph: '◐' },
  pending: { label: 'Queued', tone: 'info', glyph: '◷' },
  unsupported: { label: 'Unsupported', tone: 'neutral', glyph: '⊘' },
  failed: { label: 'Failed', tone: 'danger', glyph: '✕' },
};

export function indexStateOf(d) {
  return INDEX_STATE[d?.index_state] || { label: NOT_RECORDED, tone: 'neutral', glyph: '–' };
}

/**
 * RS-06 "Answerable in Ask": whether Ask may cite this document for you, and
 * the one-line reason when it may not. `in_ask` is the Worker's own verdict
 * (`routes/research.ts` dto) and the only one read: a second copy of the rule
 * here is where the two would disagree, and a client's `indexed` document
 * would read as citable (`research_library_shares.test.mjs`).
 */
export function answerabilityOf(d) {
  const inAsk = d?.in_ask === true;
  if (inAsk && d.index_state === 'partial') {
    return { label: 'Partly answerable', tone: 'warn', glyph: '◐', why: d.index_note || 'Ask answers from the passages that were indexed.' };
  }
  if (inAsk) return { label: 'Answerable', tone: 'ok', glyph: '✓', why: null };
  let why = 'Not answerable until indexed.';
  if (d?.source === 'client') why = 'Indexed in their library, not yours.';
  else if (d?.index_state === 'pending') why = 'Being read now.';
  return { label: 'Not answerable', tone: 'neutral', glyph: '⊘', why };
}

/**
 * The reason under a document's name and the one step that helps (RS-06: a
 * Failed row says why and offers Retry; an Unsupported row says the file
 * cannot be read and to replace it). Null for a row with nothing to act on,
 * and for a client's document, which is not the reader's to change.
 */
export function rowProblem(d) {
  if (!d || d.source === 'client') return null;
  if (d.index_state === 'failed') {
    return { reason: d.index_note || 'The last read failed.', action: 'retry', label: 'Retry' };
  }
  if (d.index_state === 'unsupported') {
    return { reason: d.index_note || 'No text could be read from this file.', action: 'replace', label: 'Remove it and add a version with readable text.' };
  }
  return null;
}

/**
 * RS-07C — the seven response states. `action` is what the state card offers:
 * `library` opens the Library, `retry` puts the question back in the composer,
 * `keep` is the save control every exchange already has.
 */
export const ASK_STATES = {
  answered: { label: 'Answered', tone: 'ok', glyph: '✓', body: 'Answer with numbered sources.', action: 'keep' },
  no_source: { label: 'No relevant source found', tone: 'neutral', glyph: '○', body: 'Your answerable documents don’t cover this. Nothing was made up.', action: 'library', actionLabel: 'Add evidence' },
  no_answerable_documents: { label: 'No answerable documents', tone: 'neutral', glyph: '⊘', body: 'Nothing in your Library is indexed yet.', action: 'library', actionLabel: 'Open Library' },
  retrieval_unavailable: { label: 'Search temporarily unavailable', tone: 'neutral', glyph: '⊠', body: 'The search index didn’t respond. Your question is kept.', action: 'retry', actionLabel: 'Try again' },
  model_unavailable: { label: 'Model unavailable', tone: 'danger', glyph: '✕', body: 'The model didn’t respond. No answer was charged.', action: 'retry', actionLabel: 'Try again' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'warn', glyph: '▲', body: 'Sources touch the topic but don’t support an answer.', proposed: true },
  source_unavailable: { label: 'Source no longer available', tone: 'neutral', glyph: '⊠', body: 'A cited document was removed after this answer. The answer is kept as it was written.', action: null },
};

/**
 * Which response state one recorded exchange is in.
 *
 * `libraryUids` is the set of document uids the library read returned, or
 * null when that read has not succeeded. Only a successful read can show a
 * citation's document is gone.
 */
export function askStateOf(t, { libraryUids = null } = {}) {
  const reason = t?.reason;
  if (reason === 'answered') {
    const cited = (t.citations || []).map((c) => c?.document_uid).filter(Boolean);
    if (libraryUids && cited.some((uid) => !libraryUids.has(uid))) return 'source_unavailable';
    return 'answered';
  }
  if (reason === 'no_source') return t.indexed_documents === 0 ? 'no_answerable_documents' : 'no_source';
  if (reason === 'retrieval_unavailable' || reason === 'model_unavailable') return reason;
  return null;
}

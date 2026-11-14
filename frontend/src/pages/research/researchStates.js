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
  if (!d || d.source === 'client' || d.read_only === true || d.in_ask === true) return null;
  if (d.index_state === 'failed') {
    return { reason: d.index_note || 'The last read failed.', action: 'retry', label: 'Retry' };
  }
  if (d.index_state === 'unsupported') {
    return { reason: d.index_note || 'No text could be read from this file.', action: 'replace', label: 'Remove it and add a version with readable text.' };
  }
  return null;
}

/**
 * D6281 (#6281, RS-06's departures from D3701) — the Library's search, its four
 * filters and the drop-to-upload check, as pure functions so the page and its
 * test read one rule.
 *
 * KEPT IN THE URL. Each filter is a query parameter, so a reload or Back lands
 * on the same view. An empty or unknown value is no filter, never a filter that
 * matches nothing.
 *
 * TYPE IS THE FILE TYPE, NOT THE KIND (D3701 "Library columns"): the canvas's
 * Type column names the file (PDF, Word…), read from the stored
 * `content_type`. A document with none recorded is Not recorded, never PDF.
 */
export const LIBRARY_PARAMS = ['q', 'type', 'index', 'answerable', 'collection', 'view'];

const FILE_TYPES = {
  'application/pdf': { key: 'pdf', label: 'PDF' },
  'application/msword': { key: 'word', label: 'Word' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { key: 'word', label: 'Word' },
  'application/vnd.ms-powerpoint': { key: 'powerpoint', label: 'PowerPoint' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { key: 'powerpoint', label: 'PowerPoint' },
  'text/plain': { key: 'text', label: 'Text' },
  'text/markdown': { key: 'markdown', label: 'Markdown' },
  'text/csv': { key: 'csv', label: 'CSV' },
};
const UNRECORDED_TYPE = { key: 'unrecorded', label: NOT_RECORDED };

/** RS-06 "Type": the file type from the stored content type. */
export function fileTypeOf(d) {
  return FILE_TYPES[String(d?.content_type || '').split(';')[0].trim().toLowerCase()] || UNRECORDED_TYPE;
}

/** RS-06 "Answerable in Ask" as a filter key, from the same `answerabilityOf`. */
export function answerabilityKeyOf(d) {
  const label = answerabilityOf(d).label;
  return label === 'Answerable' ? 'answerable' : label === 'Partly answerable' ? 'partial' : 'not';
}

/** The index-state filter key: the indexer's word, or `unrecorded` (Not recorded). */
export function indexKeyOf(d) {
  return INDEX_STATE[d?.index_state] ? d.index_state : 'unrecorded';
}

export const ANSWERABLE_OPTIONS = [
  { key: 'answerable', label: 'Answerable' },
  { key: 'partial', label: 'Partly answerable' },
  { key: 'not', label: 'Not answerable' },
];

/** The filter options a list offers: only values some document carries, in a fixed order. */
export function libraryOptions(items) {
  const types = new Map();
  for (const d of items || []) { const t = fileTypeOf(d); types.set(t.key, t.label); }
  const ix = new Set((items || []).map(indexKeyOf));
  return {
    type: [...types].map(([key, label]) => ({ key, label })).sort((a, b) => (a.key === 'unrecorded') - (b.key === 'unrecorded') || a.label.localeCompare(b.label)),
    index: [...Object.keys(INDEX_STATE), 'unrecorded'].filter((k) => ix.has(k)).map((key) => ({ key, label: INDEX_STATE[key]?.label || NOT_RECORDED })),
    answerable: ANSWERABLE_OPTIONS,
  };
}

/** The filters a URL carries. Missing parameters are '' (no filter); `view` defaults to `all`. */
export function libraryFiltersFrom(params) {
  const get = (k) => String(params?.get?.(k) ?? '').trim();
  return {
    q: get('q'), type: get('type'), index: get('index'), answerable: get('answerable'),
    collection: get('collection'), view: get('view') || 'all',
  };
}

/** The URL after one change: other parameters (the page's own, and any other) are kept; an empty value is removed. */
export function librarySearchFor(params, patch) {
  const next = new URLSearchParams(params?.toString?.() || '');
  for (const [k, v] of Object.entries(patch)) {
    const value = v == null ? '' : String(v);
    if (!value) next.delete(k); else next.set(k, value);
  }
  if (next.get('view') === 'all') next.delete('view');
  return next;
}

/** True when the reader has narrowed the list in any way. */
export function isFiltered(f) {
  return Boolean(f.q || f.type || f.index || f.answerable || f.collection || (f.view && f.view !== 'all'));
}

/**
 * The documents the search and the four RS-06 filters keep. `members` is the
 * selected collection's document uids, or null when it is not loaded. The
 * profile's chip view is applied by the page, which declares its keys
 * (`profile_zone_filters.test.mjs` reads them there).
 */
export function filterLibrary(items, f, members = null) {
  const q = (f.q || '').toLowerCase();
  return (items || []).filter((d) => {
    if (q && !String(d.title || '').toLowerCase().includes(q)) return false;
    if (f.type && fileTypeOf(d).key !== f.type) return false;
    if (f.index && indexKeyOf(d) !== f.index) return false;
    if (f.answerable && answerabilityKeyOf(d) !== f.answerable) return false;
    if (f.collection && !(members || []).includes(d.uid)) return false;
    return true;
  });
}

/**
 * Drop-to-upload: the reason a file is refused BEFORE it is sent, or null. The
 * same two rules the Worker applies (`routes/research.ts` ALLOWED_MIME and
 * MAX_BYTES), in its own words, so a refusal here is never one the Worker
 * would not also give. A file whose type the browser could not name is refused
 * too: the Worker reads only the type, so it would refuse it as well.
 */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv';
export const UPLOAD_TYPES_SENTENCE = 'Upload a PDF, Word, PowerPoint, text, markdown or CSV file.';
export function uploadRefusal(file) {
  if (!file) return 'Choose a file first.';
  const name = file.name || 'That file';
  if (!FILE_TYPES[String(file.type || '').toLowerCase()]) {
    return `${name} can’t be added: its type ${file.type ? `(${file.type}) ` : ''}can’t be read. ${UPLOAD_TYPES_SENTENCE}`;
  }
  if (Number(file.size) > UPLOAD_MAX_BYTES) return `${name} can’t be added: it is over the 20 MB limit.`;
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

/**
 * D3701 part 3 (RS-07) — one citation's availability. `available` while the
 * library read lists its document, `gone` when it does not, and null when the
 * library was not read or the citation names no document: unknown is not gone.
 */
export function citationAvailability(ct, libraryUids, revisions = null) {
  if (!libraryUids || !ct?.document_uid) return null;
  if (!libraryUids.has(ct.document_uid)) return 'gone';
  // D4613: the document is still here but was indexed again after this
  // answer, so the passage shown is the version the answer read, not
  // necessarily what the document says now. Unknown on either side is not
  // "changed".
  const now = revisions?.get?.(ct.document_uid);
  if (ct.revision && now && now !== ct.revision) return 'changed';
  return 'available';
}

export const CITATION_AVAILABILITY = {
  available: { label: 'Available', tone: 'ok', glyph: '✓' },
  changed: { label: 'Re-indexed since this answer', tone: 'warn', glyph: '↻' },
  gone: { label: 'No longer available', tone: 'neutral', glyph: '⊠' },
};

/**
 * D4613 — an answer's citations split into the sources it cites and the
 * passages it was given and never cites. Each keeps its index in the stored
 * list, which is what the source sheet opens by. A citation stored without a
 * `cited` mark (a payload from before D4613) counts as retrieved, never as
 * cited: unknown is not support.
 */
export function splitCitations(t) {
  const all = (Array.isArray(t?.citations) ? t.citations : []).map((ct, i) => ({ ct, i }));
  return {
    cited: all.filter(({ ct }) => ct?.cited === true),
    retrieved: all.filter(({ ct }) => ct?.cited !== true),
  };
}

/**
 * D4613 — what the page says about an answer's bracketed references, from the
 * Worker's `reference_check`. Null when there is nothing to say. A reference
 * that resolves is never called verified: it names a source the answer was
 * given, which is not proof that source supports the sentence.
 */
export function referenceNote(t) {
  const check = t?.reference_check;
  if (!check || t?.reason !== 'answered') return null;
  if (check.status === 'invalid_refs') {
    const refs = (check.invalid || []).map((n) => `[${n}]`).join(', ');
    return {
      tone: 'warn',
      text: `This answer cites ${refs}, which ${check.invalid.length === 1 ? 'is' : 'are'} not among the sources it was given. ${check.invalid.length === 1 ? 'That reference is' : 'Those references are'} unverified.`,
    };
  }
  if (check.status === 'none_cited') {
    return { tone: 'warn', text: 'This answer cites none of its sources by number, so no sentence in it is tied to a passage.' };
  }
  return null;
}

/** D4613: the sentence that keeps a resolved reference from reading as proof. */
export const REFERENCE_LIMIT = 'A numbered reference names the passage the answer drew on. It is not a check that the passage supports the sentence.';

/**
 * What "Copy with citations" puts on the clipboard: the answer, then each
 * numbered source with its page and passage as recorded. A citation stored
 * before passages were kept says so rather than copying nothing.
 */
export function answerWithCitations(t) {
  const lines = [String(t?.answer || '').trim()];
  const cites = Array.isArray(t?.citations) ? t.citations : [];
  if (cites.length) {
    lines.push('', 'Sources');
    cites.forEach((ct, i) => {
      const where = [ct.page != null ? `page ${ct.page}` : null, ct.chunk != null ? `passage ${ct.chunk + 1}` : null].filter(Boolean).join(', ');
      lines.push(`[${ct.n || i + 1}] ${ct.title || 'Untitled document'}${where ? ` (${where})` : ''}`);
      lines.push(ct.passage ? `    “${ct.passage}${ct.passage_truncated ? '…' : ''}”` : '    Passage not recorded for this answer.');
    });
  }
  return lines.join('\n');
}

/**
 * RS-07's history tabs. `session` is kept first: asking appends to the
 * current session, and leaving the reader on All after a question would make
 * the answer look lost (the reason `ask` resets the view). Archived is the
 * discarded disposition (D549).
 */
export const HISTORY_TABS = [
  { view: 'session', label: 'This session' },
  { view: 'all', label: 'All' },
  { view: 'saved', label: 'Saved answers' },
  { view: 'discarded', label: 'Archived' },
];

/**
 * D3701 part 4 (RS-11) — a press the router refused before it ran. The
 * Worker answers a budget stop with 402 in the budget's own words (D766,
 * `refuseRun`), and nothing is stored: the history stays as it was. Null for
 * any other failure, which keeps its own message.
 */
export function tokensRefusal(err) {
  if (!err || err.status !== 402) return null;
  return {
    title: 'You’re out of AI tokens',
    body: err.message || 'The included AI allowance and top-up balance cannot cover this run.',
    note: 'Add tokens to ask. Your history stays readable, and nothing was charged.',
  };
}

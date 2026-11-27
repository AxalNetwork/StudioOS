/**
 * D5157 (#5157) — what My Research and the project workspace say, read from
 * the Research Project store (`routes/research_projects.ts`). Pure, so the
 * pages and the tests read the same words.
 *
 * HONEST STATES. A read is loading, unreadable or ok, and an unreadable read
 * is never an empty list. Counts here are counts of stored links, so zero is a
 * recorded zero ("No evidence yet"). What no store holds yet (key questions,
 * the brief) reads Not recorded with its reason, never a zero or a sample.
 */
import { NOT_RECORDED, answerabilityOf, indexStateOf } from './researchStates.js';

/** The Worker's CHECK limits, mirrored for the form's own messages. */
export const LIMITS = { title: 160, question: 1000, objective: 2000, scope: 1000, exclusions: 1000 };

export const PROJECT_STATUS = {
  in_progress: { label: 'In progress', tone: 'info' },
  complete: { label: 'Complete', tone: 'ok' },
  archived: { label: 'Archived', tone: 'neutral' },
};
export const statusOf = (p) => PROJECT_STATUS[p?.status] || { label: NOT_RECORDED, tone: 'neutral' };

/** The workspace's tabs. Overview, Evidence, (part 2) Findings and (part 3) Comparisons have a store behind them. */
export const PROJECT_TABS = [
  { slug: 'overview', label: 'Overview', built: true },
  { slug: 'evidence', label: 'Evidence', built: true },
  { slug: 'findings', label: 'Findings', built: true },
  { slug: 'comparisons', label: 'Comparisons', built: true },
  { slug: 'brief', label: 'Brief', built: true },
];

export const NOT_STORED = {
  keyQuestions: 'Key questions are not stored yet, so there is nothing to count as answered.',
  tab: 'Not stored yet. This part of the project comes in a later release.',
};

/** `read` is `{ status: 'loading' | 'failed' | 'ok', value }`. */
export function readState(read) {
  if (!read || read.status === 'loading') return 'loading';
  if (read.status === 'failed') return 'unreadable';
  return 'ok';
}

/** "N sources · M answerable in Ask", or the recorded zero. */
export function evidenceLine(counts) {
  const total = Number(counts?.evidence);
  if (!Number.isFinite(total)) return NOT_RECORDED;
  if (total === 0) return 'No evidence yet';
  const answerable = Number(counts?.answerable) || 0;
  return `${total} ${total === 1 ? 'source' : 'sources'} · ${answerable} answerable in Ask`;
}

/** One My Research card. */
export function projectCard(p) {
  const counts = p?.counts || null;
  const answers = Number(counts?.answers || 0) + Number(counts?.sessions || 0);
  return {
    uid: p.uid,
    title: p.title || 'Untitled project',
    question: p.question || '',
    status: statusOf(p),
    archived: p.status === 'archived',
    evidence: evidenceLine(counts),
    ask: counts ? (answers ? `${counts.sessions} Ask ${counts.sessions === 1 ? 'session' : 'sessions'} · ${counts.answers} kept ${counts.answers === 1 ? 'answer' : 'answers'}` : 'No Ask history yet') : NOT_RECORDED,
    updated: p.updated_at || null,
    archivedAt: p.archived_at || null,
    to: `/research/projects/${encodeURIComponent(p.uid)}`,
  };
}

/** The list read as cards, newest touched first (the Worker's order is kept). */
export function projectList(read) {
  const state = readState(read);
  if (state !== 'ok') return { state };
  const items = Array.isArray(read.value?.items) ? read.value.items : [];
  return { state, cards: items.filter((p) => p && p.uid).map(projectCard), archivedCount: Number(read.value?.archived_count || 0) };
}

/** RS-01's Recent research projects: the newest three active projects. */
export function recentProjects(read, n = 3) {
  const list = projectList(read);
  if (list.state !== 'ok') return list;
  return { state: 'ok', cards: list.cards.slice(0, n), total: list.cards.length };
}

/** Where a piece of evidence came from: added to the project, a collection, or both. */
export function evidenceOrigin(d) {
  const via = Array.isArray(d?.via_collections) ? d.via_collections : [];
  const parts = [];
  if (d?.direct) parts.push('Added to this project');
  if (via.length) parts.push(`Via ${via.join(', ')}`);
  return parts.join(' · ') || NOT_RECORDED;
}

/** The Evidence tab's rows, each with the Library's two states kept apart. */
export function evidenceRows(item) {
  const list = Array.isArray(item?.evidence) ? item.evidence : [];
  return list.map((d, i) => ({
    n: i + 1,
    uid: d.uid,
    title: d.title || 'Untitled document',
    origin: evidenceOrigin(d),
    direct: Boolean(d.direct),
    year: d.source_year ?? null,
    kind: d.kind || null,
    index: indexStateOf(d),
    answer: answerabilityOf(d),
    note: d.index_state === 'failed' || d.index_state === 'unsupported' ? (d.index_note || null) : null,
    passages: Number.isFinite(Number(d.passages_used)) ? Number(d.passages_used) : null,
  }));
}

/** RS-02 Progress, from what is stored: answerable evidence as a fraction. */
export function progressFractions(item) {
  const rows = Array.isArray(item?.evidence) ? item.evidence : [];
  return {
    answerable: { n: rows.filter((d) => d.in_ask === true).length, of: rows.length },
    keyQuestions: { state: 'not_recorded', reason: NOT_STORED.keyQuestions },
  };
}

/** Client-side check of a create or edit form; the Worker checks again. */
export function draftErrors(draft, { creating = false } = {}) {
  const errors = {};
  const q = String(draft?.question ?? '').trim();
  if (!q) errors.question = 'Write the question this research answers.';
  else if (q.length > LIMITS.question) errors.question = `Keep the question under ${LIMITS.question} characters.`;
  const t = String(draft?.title ?? '').trim();
  if (!creating && !t) errors.title = 'A project needs a title.';
  if (t.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;
  for (const name of ['objective', 'scope', 'exclusions']) {
    if (String(draft?.[name] ?? '').trim().length > LIMITS[name]) errors[name] = `Keep this under ${LIMITS[name]} characters.`;
  }
  return errors;
}

/** The body a form sends: trimmed text, empty optional text as null. */
export function draftBody(draft, { creating = false } = {}) {
  const text = (v) => String(v ?? '').trim();
  const body = { question: text(draft.question) };
  if (text(draft.title)) body.title = text(draft.title);
  for (const name of ['objective', 'scope', 'exclusions']) {
    const v = text(draft[name]);
    if (v) body[name] = v;
    else if (!creating) body[name] = null;
  }
  return body;
}

/** `?new=1&question=…` opens the create form, prefilled. */
export function newFromSearch(search) {
  const params = new URLSearchParams(search || '');
  return { open: params.get('new') === '1', question: (params.get('question') || '').slice(0, LIMITS.question) };
}

/** What archiving reaches, said before it happens (Scope → Review → Result). */
export function archiveScope(item) {
  const evidence = Array.isArray(item?.evidence) ? item.evidence.length : 0;
  const collections = Array.isArray(item?.collections) ? item.collections.length : 0;
  const sessions = Array.isArray(item?.sessions) ? item.sessions.length : 0;
  return [
    'The project moves to Archived in My Research and becomes read-only.',
    `Its links stay as they are: ${evidence} ${evidence === 1 ? 'source' : 'sources'}, ${collections} ${collections === 1 ? 'collection' : 'collections'}, ${sessions} Ask ${sessions === 1 ? 'session' : 'sessions'}.`,
    'Your Library documents and Ask answers are not changed or deleted.',
    'You can restore it from My Research at any time.',
  ];
}

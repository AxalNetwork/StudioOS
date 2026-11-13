/**
 * D5157 part 2 (#5157) — a Research Project's findings: list them, save a
 * source fact or write a conclusion, edit or delete your own, and accept, edit
 * or discard an Eadwyn interpretation. Mounted at `/api/research/projects`
 * beside `research_projects.ts` (migration
 * 202611130254_5157_research_project_findings.sql).
 *
 * OWNER-SCOPED. Every route reads the project through `checkProjectOwner`, so
 * another member's project is a 404 like one that does not exist, and every
 * statement names `owner_user_id`.
 *
 * A CITATION NAMES WHAT THE PROJECT HOLDS. A source fact or a conclusion may
 * only cite a passage one of the project's Ask answers recorded, or a document
 * in the project's evidence, and the cited document must be in that evidence.
 * Anything else is 400 `citation_not_in_project`. The passage is copied as the
 * answer recorded it, so a re-index never changes what a finding cited.
 *
 * NO MODEL RUNS HERE. An interpretation proposal is one of the project's
 * answered Ask answers that has no decision yet: Eadwyn's words as Ask
 * recorded them, with the sources the answer cites. Nothing is stored until the
 * member accepts, edits or discards it, and Eadwyn's words are kept beside an
 * edit. A resolved citation is a reference, not verified support (D4613).
 *
 * AN ARCHIVED PROJECT IS READ-ONLY (409 `project_archived`), as in part 1.
 * Every write leaves an audit receipt without the finding's text.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { markCited } from '../services/researchCitations';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner } from './research_projects';

const findings = new Hono<{ Bindings: Env }>();

/** The longest text a member may type into a finding. */
export const FINDING_TEXT_LIMIT = 4000;
/** The most citations one finding keeps. */
export const CITATION_LIMIT = 8;
const KINDS_WRITTEN = new Set(['source_fact', 'conclusion']);
const DECISIONS = { accept: 'accepted', edit: 'edited', discard: 'discarded' } as const;
/** D4605: the index states Ask may answer from. */
const ANSWERABLE_STATES = ['indexed', 'partial'];

interface AnswerRow { id: number; uid: string; question: string; answer: string | null; reason: string; citations: string; created_at: string }
interface StoredCite { n?: unknown; title?: unknown; document_uid?: unknown; passage?: unknown; page?: unknown; [key: string]: unknown }
interface DocRow { id: number; uid: string; title: string; index_state: string; source_year: number | null }
interface CitationIn { document_id: number | null; document_uid: string | null; title: string; passage: string | null; page: number | null; answer_id: number | null }

const newUid = () => crypto.randomUUID().replace(/-/g, '');
const numberOf = (c: StoredCite, i: number) => (Number.isInteger(c?.n) && (c.n as number) > 0 ? (c.n as number) : i + 1);

/** The stored citations JSON as an array; a malformed value is no citations. */
export function storedCites(raw: string | null | undefined): StoredCite[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === 'object') : [];
  } catch { return []; }
}

/** The project's Ask answers: linked one by one, or in a linked session. */
async function projectAnswers(env: Env, projectId: number, userId: number) {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.uid, a.question, a.answer, a.reason, a.citations, a.created_at
       FROM research_ask_answers a
      WHERE a.owner_user_id = ?
        AND (a.id IN (SELECT answer_id FROM research_project_answers WHERE project_id = ?)
             OR a.session_id IN (SELECT session_id FROM research_project_sessions WHERE project_id = ?))
      ORDER BY a.id DESC LIMIT 500`
  ).bind(userId, projectId, projectId).all<AnswerRow>();
  return rows.results || [];
}

/** The project's evidence by document uid: linked directly or through a collection. */
async function projectEvidence(env: Env, projectId: number, userId: number) {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT d.id, d.uid, d.title, d.index_state, d.source_year
       FROM (SELECT pd.document_id FROM research_project_documents pd WHERE pd.project_id = ?
             UNION
             SELECT cd.document_id FROM research_project_collections pc
               JOIN research_collections col ON col.id = pc.collection_id AND col.owner_user_id = ?
               JOIN research_collection_documents cd ON cd.collection_id = pc.collection_id
              WHERE pc.project_id = ?) e
       JOIN research_documents d ON d.id = e.document_id AND d.owner_user_id = ?`
  ).bind(projectId, userId, projectId, userId).all<DocRow>();
  return new Map((rows.results || []).map((d) => [d.uid, d]));
}

/** The caller's own documents among `uids`, by uid (one bound JSON list). */
async function ownedDocuments(env: Env, userId: number, uids: string[]) {
  if (!uids.length) return new Map<string, DocRow>();
  const rows = await env.DB.prepare(
    `SELECT id, uid, title, index_state, source_year FROM research_documents
      WHERE owner_user_id = ? AND uid IN (SELECT value FROM json_each(?))`
  ).bind(userId, JSON.stringify([...new Set(uids)])).all<DocRow>();
  return new Map((rows.results || []).map((d) => [d.uid, d]));
}

const touch = (env: Env, id: number) =>
  env.DB.prepare("UPDATE research_projects SET updated_at = datetime('now') WHERE id = ?").bind(id).run();

/** Text a member typed: trimmed, required, inside the limit. */
export function readText(value: unknown): { value?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'text_required' };
  const text = value.trim();
  if (text.length > FINDING_TEXT_LIMIT) return { error: 'text_too_long' };
  return { value: text };
}

/**
 * The citations a member sent, resolved against what the project holds.
 * `{ answer_uid, n }` names a passage one of the project's answers recorded;
 * `{ document_uid }` names a document in the project's evidence. Either way
 * the document must be in the evidence. Duplicates collapse to one.
 */
export function resolveCitations(
  input: unknown,
  answers: AnswerRow[],
  evidence: Map<string, DocRow>,
): { citations?: CitationIn[]; error?: string } {
  if (input === undefined || input === null) return { citations: [] };
  if (!Array.isArray(input)) return { error: 'invalid_citations' };
  if (input.length > CITATION_LIMIT) return { error: 'too_many_citations' };
  const byUid = new Map(answers.map((a) => [a.uid, a]));
  const out: CitationIn[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { error: 'invalid_citations' };
    const { answer_uid: answerUid, n, document_uid: documentUid } = raw as Record<string, unknown>;
    let cite: CitationIn;
    if (typeof answerUid === 'string' && answerUid) {
      const answer = byUid.get(answerUid);
      if (!answer || !Number.isInteger(n)) return { error: 'citation_not_in_project' };
      const list = storedCites(answer.citations);
      const found = list.find((c, i) => numberOf(c, i) === n);
      const uid = typeof found?.document_uid === 'string' ? found.document_uid : '';
      const doc = uid ? evidence.get(uid) : undefined;
      if (!found || !doc) return { error: 'citation_not_in_project' };
      cite = {
        document_id: doc.id, document_uid: doc.uid,
        title: typeof found.title === 'string' && found.title ? found.title : doc.title,
        passage: typeof found.passage === 'string' && found.passage ? found.passage : null,
        page: Number.isInteger(found.page) ? (found.page as number) : null,
        answer_id: answer.id,
      };
    } else if (typeof documentUid === 'string' && documentUid) {
      const doc = evidence.get(documentUid);
      if (!doc) return { error: 'citation_not_in_project' };
      cite = { document_id: doc.id, document_uid: doc.uid, title: doc.title, passage: null, page: null, answer_id: null };
    } else {
      return { error: 'invalid_citations' };
    }
    const key = `${cite.document_uid}|${cite.answer_id ?? ''}|${cite.passage ?? ''}`;
    if (!seen.has(key)) { seen.add(key); out.push(cite); }
  }
  return { citations: out };
}

/** The sources an Ask answer cites, as citations to keep with an interpretation. */
export function answerCitations(answer: AnswerRow, owned: Map<string, DocRow>): CitationIn[] {
  return markCited(answer.answer, storedCites(answer.citations) as Array<StoredCite & { n?: number | null }>)
    .filter((c) => c.cited)
    .map((c) => {
      const uid = typeof c.document_uid === 'string' && c.document_uid ? c.document_uid : null;
      const doc = uid ? owned.get(uid) : undefined;
      return {
        document_id: doc?.id ?? null, document_uid: uid,
        title: typeof c.title === 'string' && c.title ? c.title : (doc?.title || 'Untitled document'),
        passage: typeof c.passage === 'string' && c.passage ? c.passage : null,
        page: Number.isInteger(c.page) ? (c.page as number) : null,
        answer_id: answer.id,
      };
    });
}

async function writeCitations(env: Env, findingId: number, citations: CitationIn[]) {
  await env.DB.prepare('DELETE FROM research_project_finding_citations WHERE finding_id = ?').bind(findingId).run();
  let n = 0;
  for (const c of citations) {
    n += 1;
    await env.DB.prepare(
      `INSERT INTO research_project_finding_citations (finding_id, n, document_id, document_uid, title, passage, page, answer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(findingId, n, c.document_id, c.document_uid, c.title, c.passage, c.page, c.answer_id).run();
  }
}

/** One citation as the page reads it: the frozen passage and the source's state now. */
function citationDto(
  c: { n: number; document_uid: string | null; title: string; passage: string | null; page: number | null; available?: number | null; answer_uid?: string | null },
  owned: Map<string, DocRow>,
  evidence: Map<string, DocRow>,
) {
  const doc = c.document_uid ? owned.get(c.document_uid) : undefined;
  const live = c.available === undefined ? Boolean(doc) : Boolean(c.available) && Boolean(doc);
  return {
    n: c.n,
    document_uid: c.document_uid,
    title: c.title,
    passage: c.passage,
    page: c.page,
    answer_uid: c.answer_uid ?? null,
    // `removed`: the document is gone, so only the recorded passage remains.
    // `not_recorded`: an old Ask citation that never named its document.
    availability: !c.document_uid ? 'not_recorded' : live ? 'available' : 'removed',
    in_evidence: Boolean(c.document_uid && evidence.has(c.document_uid)),
    index_state: live && doc ? doc.index_state : null,
    in_ask: live && doc ? ANSWERABLE_STATES.includes(doc.index_state) : null,
    source_year: live && doc ? doc.source_year ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// The Findings tab
// ---------------------------------------------------------------------------

findings.get('/:uid/findings', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.uid, f.kind, f.text, f.proposed_text, f.state, f.decided_at, f.created_at, f.updated_at, a.uid AS answer_uid
       FROM research_project_findings f
       LEFT JOIN research_ask_answers a ON a.id = f.answer_id AND a.owner_user_id = ?
      WHERE f.project_id = ? AND f.owner_user_id = ?
      ORDER BY f.id DESC LIMIT 500`
  ).bind(user.id, project.id, user.id).all<{
    id: number; uid: string; kind: string; text: string; proposed_text: string | null; state: string | null;
    decided_at: string; created_at: string; updated_at: string; answer_uid: string | null;
  }>();
  const cites = await c.env.DB.prepare(
    `SELECT fc.finding_id, fc.n, fc.document_uid, fc.title, fc.passage, fc.page,
            (fc.document_id IS NOT NULL) AS available, a.uid AS answer_uid
       FROM research_project_finding_citations fc
       JOIN research_project_findings f ON f.id = fc.finding_id
       LEFT JOIN research_ask_answers a ON a.id = fc.answer_id AND a.owner_user_id = ?
      WHERE f.project_id = ? AND f.owner_user_id = ?
      ORDER BY fc.finding_id, fc.n`
  ).bind(user.id, project.id, user.id).all<{
    finding_id: number; n: number; document_uid: string | null; title: string; passage: string | null; page: number | null; available: number; answer_uid: string | null;
  }>();
  const answers = await projectAnswers(c.env, project.id, user.id);
  const evidence = await projectEvidence(c.env, project.id, user.id);
  const decided = new Set((rows.results || []).filter((r) => r.kind === 'interpretation' && r.answer_uid).map((r) => r.answer_uid));
  const open = answers.filter((a) => a.reason === 'answered' && a.answer && a.answer.trim() && !decided.has(a.uid));
  const referenced = [
    ...(cites.results || []).map((r) => r.document_uid),
    ...open.flatMap((a) => storedCites(a.citations).map((x) => x.document_uid)),
  ].filter((u): u is string => typeof u === 'string' && Boolean(u));
  const owned = await ownedDocuments(c.env, user.id, referenced);

  const byFinding = new Map<number, ReturnType<typeof citationDto>[]>();
  for (const r of cites.results || []) {
    const list = byFinding.get(r.finding_id) || [];
    list.push(citationDto(r, owned, evidence));
    byFinding.set(r.finding_id, list);
  }
  const items = (rows.results || []).map((r) => ({
    uid: r.uid, kind: r.kind, text: r.text, proposed_text: r.proposed_text, state: r.state,
    answer_uid: r.answer_uid, decided_at: r.decided_at, created_at: r.created_at, updated_at: r.updated_at,
    citations: byFinding.get(r.id) || [],
  }));
  const proposals = open.map((a) => ({
    answer_uid: a.uid, question: a.question, text: a.answer, created_at: a.created_at,
    citations: answerCitations(a, owned).map((x, i) => citationDto({ ...x, n: i + 1, answer_uid: a.uid }, owned, evidence)),
  }));
  // The passages a source fact may cite: each recorded with one of the
  // project's answers, from a document in the project's evidence.
  const passages = answers.flatMap((a) => storedCites(a.citations).map((x, i) => ({ x, n: numberOf(x, i), a })))
    .filter(({ x }) => typeof x.document_uid === 'string' && evidence.has(x.document_uid) && typeof x.passage === 'string' && x.passage)
    .slice(0, 200)
    .map(({ x, n, a }) => ({
      answer_uid: a.uid, n, question: a.question, document_uid: x.document_uid as string,
      title: typeof x.title === 'string' && x.title ? x.title : evidence.get(x.document_uid as string)!.title,
      passage: x.passage as string, page: Number.isInteger(x.page) ? x.page : null,
    }));
  const count = (kind: string) => items.filter((i) => i.kind === kind && i.state !== 'discarded').length;
  return c.json({
    project: { uid: project.uid, status: project.status },
    items,
    proposals,
    passages,
    evidence: [...evidence.values()].map((d) => ({ uid: d.uid, title: d.title })),
    counts: {
      source_fact: count('source_fact'),
      interpretation: count('interpretation'),
      conclusion: count('conclusion'),
      discarded: items.filter((i) => i.state === 'discarded').length,
      proposals: proposals.length,
    },
  });
});

findings.post('/:uid/findings', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  if (project.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  // An interpretation is never typed in: it is decided on from an Ask answer.
  if (!KINDS_WRITTEN.has(body.kind)) return c.json({ detail: 'invalid_kind' }, 400);
  const text = readText(body.text);
  if (text.error) return c.json({ detail: text.error }, 400);
  const answers = await projectAnswers(c.env, project.id, user.id);
  const evidence = await projectEvidence(c.env, project.id, user.id);
  const resolved = resolveCitations(body.citations, answers, evidence);
  if (resolved.error) return c.json({ detail: resolved.error }, 400);
  const citations = resolved.citations || [];
  // A source fact stands on a recorded passage; a conclusion may stand alone.
  if (body.kind === 'source_fact' && !citations.some((x) => x.passage)) return c.json({ detail: 'passage_required' }, 400);
  const uid = newUid();
  const made = await c.env.DB.prepare(
    `INSERT INTO research_project_findings (uid, project_id, owner_user_id, kind, text, decided_by, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(uid, project.id, user.id, body.kind, text.value, user.id, user.id).first<{ id: number }>();
  await writeCitations(c.env, made!.id, citations);
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_finding_added', { project_uid: project.uid, finding_uid: uid, kind: body.kind, citations: citations.length });
  return c.json({ item: { uid, kind: body.kind } }, 201);
});

/** The caller's own finding in this project, or null. */
const ownFinding = (env: Env, projectId: number, uid: string, userId: number) => env.DB.prepare(
  'SELECT id, uid, kind, text, state FROM research_project_findings WHERE uid = ? AND project_id = ? AND owner_user_id = ?'
).bind(uid, projectId, userId).first<{ id: number; uid: string; kind: string; text: string; state: string | null }>();

findings.patch('/:uid/findings/:findingUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  if (project.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  const finding = await ownFinding(c.env, project.id, c.req.param('findingUid'), user.id);
  if (!finding) return c.json({ detail: 'not_found' }, 404);
  // Only your conclusion is edited here; an interpretation is edited by its decision.
  if (finding.kind !== 'conclusion') return c.json({ detail: 'finding_not_editable' }, 409);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  const text = readText(body.text);
  if (text.error) return c.json({ detail: text.error }, 400);
  let citations: CitationIn[] | undefined;
  if (body.citations !== undefined) {
    const resolved = resolveCitations(body.citations, await projectAnswers(c.env, project.id, user.id), await projectEvidence(c.env, project.id, user.id));
    if (resolved.error) return c.json({ detail: resolved.error }, 400);
    citations = resolved.citations;
  }
  await c.env.DB.prepare(
    "UPDATE research_project_findings SET text = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).bind(text.value, user.id, finding.id, user.id).run();
  if (citations) await writeCitations(c.env, finding.id, citations);
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_finding_updated', { project_uid: project.uid, finding_uid: finding.uid, kind: finding.kind });
  return c.json({ ok: true });
});

findings.delete('/:uid/findings/:findingUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  if (project.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  const finding = await ownFinding(c.env, project.id, c.req.param('findingUid'), user.id);
  if (!finding) return c.json({ detail: 'not_found' }, 404);
  // A decision on Eadwyn's words stays on record; Discard is how it is set aside.
  if (finding.kind === 'interpretation') return c.json({ detail: 'finding_not_deletable' }, 409);
  await c.env.DB.prepare('DELETE FROM research_project_findings WHERE id = ? AND owner_user_id = ?').bind(finding.id, user.id).run();
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_finding_deleted', { project_uid: project.uid, finding_uid: finding.uid, kind: finding.kind });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Eadwyn interpretations: Accept, Edit, Discard
// ---------------------------------------------------------------------------

findings.post('/:uid/interpretations/:answerUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  if (project.status === 'archived') return c.json({ detail: 'project_archived' }, 409);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  const decision = body.decision === 'accept' || body.decision === 'edit' || body.decision === 'discard' ? body.decision as keyof typeof DECISIONS : null;
  if (!decision) return c.json({ detail: 'invalid_decision' }, 400);
  // The answer must be one this project holds, answered, with words to decide on.
  const answer = (await projectAnswers(c.env, project.id, user.id)).find((a) => a.uid === c.req.param('answerUid'));
  if (!answer) return c.json({ detail: 'not_found' }, 404);
  if (answer.reason !== 'answered' || !answer.answer || !answer.answer.trim()) return c.json({ detail: 'nothing_to_interpret' }, 409);
  const proposed = answer.answer.trim();
  let text = proposed;
  if (decision === 'edit') {
    const typed = readText(body.text);
    if (typed.error) return c.json({ detail: typed.error }, 400);
    if (typed.value === proposed) return c.json({ detail: 'text_unchanged' }, 400);
    text = typed.value!;
  }
  const state = DECISIONS[decision];
  const existing = await c.env.DB.prepare(
    "SELECT id, uid FROM research_project_findings WHERE project_id = ? AND answer_id = ? AND kind = 'interpretation' AND owner_user_id = ?"
  ).bind(project.id, answer.id, user.id).first<{ id: number; uid: string }>();
  let uid: string;
  if (existing) {
    uid = existing.uid;
    await c.env.DB.prepare(
      "UPDATE research_project_findings SET text = ?, state = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
    ).bind(text, state, user.id, existing.id, user.id).run();
  } else {
    uid = newUid();
    const made = await c.env.DB.prepare(
      `INSERT INTO research_project_findings (uid, project_id, owner_user_id, kind, text, proposed_text, answer_id, state, decided_by, created_by)
       VALUES (?, ?, ?, 'interpretation', ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(uid, project.id, user.id, text, proposed, answer.id, state, user.id, user.id).first<{ id: number }>();
    const uids = storedCites(answer.citations).map((x) => x.document_uid).filter((u): u is string => typeof u === 'string' && Boolean(u));
    await writeCitations(c.env, made!.id, answerCitations(answer, await ownedDocuments(c.env, user.id, uids)));
  }
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_interpretation_decided', { project_uid: project.uid, finding_uid: uid, answer_uid: answer.uid, decision: state });
  return c.json({ item: { uid, kind: 'interpretation', state } });
});

export const mount: RouteMount = { path: '/api/research/projects', router: findings };
export default findings;

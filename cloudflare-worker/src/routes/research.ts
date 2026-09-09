/**
 * `/api/research/*` — the document library, and Ask over it.
 *
 * WHAT THIS IS, AND WHAT D12 ACTUALLY WITHDREW. Decisions D9/D12 pulled four
 * `/advisor/research/*` tabs because each rendered a fixture with no API
 * behind it, and set one condition for their return: a licensed
 * PitchBook/Crunchbase-class source. That condition governs THIRD-PARTY
 * research — companies, AI research, news. It does not govern this. The
 * surface here is first-party: your own documents, your own playbooks, and
 * questions answered only from them. Unbuilt, never forbidden.
 *
 * EVERY LICENCE HAS THESE ZONES. `library` and `ask` are in all four
 * `RESEARCH_ZONES` lists, so the store is keyed on `user_id` rather than on
 * any one role's profile row, and there is no cross-user listing anywhere in
 * this file by construction — every read is `WHERE owner_user_id = ?`.
 *
 * WHAT IS NOT HERE, AND WHAT CHANGED. A founder still cannot push a document
 * to an advisor FROM THIS FILE, and the library zone still says so. What moved
 * is the reason: the grant type that did not exist now does — migration 218's
 * `advisor_client_grants`, one project, one named advisor, revocable, expiring
 * and scoped — and `advisor_client_document_shares` beside it is the additive
 * change migration 213's header pre-authorised.
 *
 * THAT TABLE NOW HAS A WRITER, AND THIS PARAGRAPH USED TO SAY IT DID NOT.
 * Task #104 built `POST`/`DELETE /api/advisor-grants/:projectUid/documents`
 * and the control beside `AdvisorGrantSection`, so a founder can pick a file
 * and send it to one named advisor who already holds a live grant. An empty
 * library therefore no longer means "nobody CAN send you a document" — it
 * means nobody HAS.
 *
 * Nothing about the isolation changed. A shared document is still resolved by
 * id through `advisor_client_document_shares` and no namespace is widened;
 * D37 and `research_search_isolation.test.ts` are untouched.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { Jobs } from '../models/jobs';
import { mintDownloadToken } from '../services/signedDownload';
import { searchSemantic, deleteChunkedEntity, researchNamespace } from '../services/vectorize';
import { run as runAI } from '../services/aiRouter';
import { companyScope } from '../services/tenancyScope';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';

const research = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB, matching deck_reviewer.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};
const KINDS = new Set(['playbook', 'client', 'document']);

/**
 * THE FLOOR BELOW WHICH ASK REFUSES TO ANSWER.
 *
 * Cosine similarity from bge-base. A question whose best match scores under
 * this has no source in the library worth citing, and the honest response is
 * to say so — not to answer from the model's general knowledge in the same
 * voice a cited answer uses. That is precisely the failure D12 withdrew a tab
 * for, and the canvas draws `No source` as a tile beside `Answered` rather
 * than treating it as an error.
 *
 * A CONSTANT, NOT A SETTING. Nothing can change it, so a per-user column
 * would be a table pretending to be a control. The page states the value.
 */
const SCORE_FLOOR = 0.55;

const nowIso = () => new Date().toISOString();
const newUid = () => crypto.randomUUID().replace(/-/g, '');

interface DocRow {
  id: number; uid: string; owner_user_id: number; title: string; kind: string;
  r2_key: string; content_type: string | null; size_bytes: number | null;
  index_state: string; index_note: string | null; chunk_count: number | null;
  indexed_at: string | null; created_at: string; updated_at: string;
}

/**
 * `source` IS WHERE A DOCUMENT CAME FROM, AND IT IS NOT A COLUMN.
 *
 * The `pr4` artboard's fourth tile is `From clients` — "read-only, seam-marked"
 * — and two of its six rows carry the cyan seam chip. `research_documents` has
 * `kind`, whose `client` value the upload form calls "About a client": that is
 * what a document is ABOUT, not where it came from. A teardown the firm wrote
 * about a prospect and a brief the prospect sent them are both `kind = 'client'`
 * today, and only one of them is read-only.
 *
 * A FIRST DRAFT ADDED `source` AND `source_label` COLUMNS IN A MIGRATION AND
 * THAT WAS WRONG. Nothing would have written them. `advisor_client_document_shares`
 * (migration 218) already records exactly this fact — which document, shared
 * with whom, active or revoked — so the column would have been a second copy of
 * a truth that already exists, with no writer, which is the first failure D53's
 * four-step check is for. The list reads both sets instead.
 *
 * NOTHING IS COPIED AND NO NAMESPACE WIDENS. A shared document is listed, not
 * duplicated; it is indexed in the CLIENT's namespace and `searchSemantic` still
 * only ever searches the caller's own, so `In Ask` reports it as unreachable —
 * which is true, and is a sharper version of the artboard's own point that index
 * state is Ask's reach. D37 is untouched.
 */
const dto = (r: DocRow, source: 'own' | 'client' = 'own', sourceLabel: string | null = null) => ({
  uid: r.uid,
  title: r.title,
  kind: r.kind,
  content_type: r.content_type,
  size_bytes: r.size_bytes,
  index_state: r.index_state,
  index_note: r.index_note,
  // NULL, not 0. "Never indexed" and "indexed into nothing" are different
  // facts, and only one of them means Ask can read the file.
  chunk_count: r.chunk_count,
  indexed_at: r.indexed_at,
  created_at: r.created_at,
  source,
  source_label: sourceLabel,
  // Stated by the route rather than derived in the page. The rule is the
  // route's — a shared document's uid is not in the caller's own set, so every
  // write path 404s on it already — and a second copy of it in the client would
  // be the place the two disagree.
  read_only: source === 'client',
  // What Ask can actually reach. An own document is answerable when it is
  // indexed; a shared one never is, because it is indexed somewhere else.
  in_ask: source === 'own' && r.index_state === 'indexed',
});

/** Always scoped to the caller. There is no route here that reads another user's row. */
async function ownDoc(env: Env, userId: number, uid: string): Promise<DocRow | null> {
  return env.DB.prepare(
    `SELECT * FROM research_documents WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, userId).first<DocRow>();
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

research.get('/documents', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_documents WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(user.id).all<DocRow>();

  // The documents clients have opened to this reader, through the grants
  // migration 218 already models. `status = 'active'` because a revoke is a
  // state rather than a delete, and a revoked share must stop appearing here
  // the moment it is revoked.
  //
  // The project's name is the seam chip's label — "From Verwood" — and it is
  // taken from the grant rather than stored on the document, so a project
  // renamed after the share still labels correctly.
  // A CORRELATED SUBQUERY FOR THE NAME, not a join, because a reader can hold
  // grants over several projects and joining would return the same document
  // once per grant. This picks the newest grant this reader holds over a
  // project belonging to the document's owner, which is the client the file
  // came from.
  const shared = await c.env.DB.prepare(
    `SELECT d.*, (
              SELECT p.name
                FROM advisor_client_grants g
                JOIN projects p ON p.id = g.project_id
               WHERE g.advisor_user_id = s.advisor_user_id
                 AND g.status = 'active'
                 AND p.founder_id = d.owner_user_id
               ORDER BY g.id DESC LIMIT 1
            ) AS project_name
       FROM advisor_client_document_shares s
       JOIN research_documents d ON d.id = s.document_id
      WHERE s.advisor_user_id = ? AND s.status = 'active'
      ORDER BY d.created_at DESC LIMIT 200`
  ).bind(user.id).all<DocRow & { project_name: string | null }>();

  const items = [
    ...(rows.results || []).map((r) => dto(r, 'own')),
    ...(shared.results || []).map((r) => dto(r, 'client', r.project_name ? `From ${r.project_name}` : 'From client')),
  ];
  return c.json({
    items,
    // The library's own reach, stated rather than left for a reader to count.
    indexed: items.filter((i) => i.index_state === 'indexed').length,
    not_indexed: items.filter((i) => i.index_state !== 'indexed').length,
    // The `pr4` artboard's fourth tile. Counted here rather than in the page so
    // the tile and the `Client docs` chip cannot disagree about what the word
    // means: this is provenance (migration 222), NOT `kind = 'client'`, which
    // is what a document is about.
    from_clients: items.filter((i) => i.source === 'client').length,
    score_floor: SCORE_FLOOR,
  });
});

/**
 * Re-index one document — the artboard's `Re-index` op, which was
 * `unbuilt: 'indexing runs on upload; there is no re-run control'`.
 *
 * That was true and is the gap the whole `pr4` composition turns on: its
 * Thornfield teardown row is a document the firm added and never indexed, so it
 * answers nothing in Ask, and there was no way to act on it from the page that
 * reports it. Re-queuing is the act.
 *
 * A CLIENT-SOURCED DOCUMENT MAY BE RE-INDEXED. Read-only means the reader
 * cannot change or delete it; indexing writes nothing to the document and only
 * touches the reader's own namespace, which is the reason the file is in front
 * of them at all.
 */
research.post('/documents/:uid/reindex', async (c) => {
  const user = await requireAuth(c);
  const doc = await ownDoc(c.env, user.id, c.req.param('uid'));
  if (!doc) return c.json({ detail: 'not_found' }, 404);
  // Already queued. Re-queuing would put a second job behind the first for the
  // same file, and the page would report "reading" either way.
  if (doc.index_state === 'pending') return c.json({ detail: 'already_queued' }, 409);
  await c.env.DB.prepare(
    `UPDATE research_documents
        SET index_state = 'pending', index_note = NULL, updated_at = datetime('now')
      WHERE id = ? AND owner_user_id = ?`
  ).bind(doc.id, user.id).run();
  // The SAME job the upload path enqueues, `embed_entity` over `research_doc`
  // — not a second indexer. Two enqueue shapes for one piece of work is how the
  // re-run and the first run drift into indexing differently, and the second
  // one is the one nobody tests.
  try {
    await Jobs.enqueue(c.env, 'embed_entity', { type: 'research_doc', id: doc.id });
  } catch {
    // The hourly sweep walks `index_state` past a watermark and will catch it,
    // which is why the upload path swallows this too. The row is already
    // 'pending', so the page reports the truth either way.
  }
  const fresh = await ownDoc(c.env, user.id, doc.uid);
  return c.json({ item: fresh ? dto(fresh) : null });
});

research.post('/documents', async (c) => {
  const user = await requireAuth(c);
  // `FILES` is optional in types.ts, so a missing bucket is a 503 with a
  // reason rather than a crash — same shape as data_room.ts.
  if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: 'invalid_form' }, 400);
  }
  // Workers-types declares FormData entries as string; at runtime an upload is
  // a File. Narrowing out the string case is load-bearing, not defensive.
  const entry = form.get('file') as unknown;
  if (!entry || typeof entry === 'string') return c.json({ detail: 'file_required' }, 400);
  const file = entry as File;

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    return c.json({ detail: 'unsupported_type', message: 'Upload a PDF, Word, PowerPoint, text, markdown or CSV file.' }, 415);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ detail: 'too_large', message: 'That file is over the 20 MB limit.' }, 413);
  }

  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw) ? kindRaw : 'document';
  const titleRaw = form.get('title');
  const title = (typeof titleRaw === 'string' && titleRaw.trim())
    ? titleRaw.trim().slice(0, 200)
    : (file.name || 'Untitled').replace(/\.[^.]+$/, '').slice(0, 200);

  const uid = newUid();
  // DERIVED SERVER-SIDE, NEVER TAKEN FROM THE REQUEST. A caller-supplied key
  // is a path-traversal write into another account's prefix.
  const r2Key = `research/${user.id}/${uid}.${EXT_BY_MIME[mime] || 'bin'}`;

  try {
    await c.env.FILES.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
      customMetadata: { owner_user_id: String(user.id), doc_uid: uid, filename: file.name || 'document' },
    });
  } catch (e) {
    console.error('[research] R2 put failed:', (e as Error).message);
    return c.json({ detail: 'storage_write_failed' }, 502);
  }

  const ins = await c.env.DB.prepare(
    `INSERT INTO research_documents
       (uid, owner_user_id, title, kind, r2_key, content_type, size_bytes, index_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(uid, user.id, title, kind, r2Key, mime, file.size, nowIso(), nowIso()).run();

  // Indexing runs on the queue, not inline: extraction plus up to 200 embed
  // calls is far too long to hold a request open, and the row is already
  // useful (listed, downloadable) while `index_state` is 'pending'.
  const id = (ins as any).meta?.last_row_id;
  if (id) {
    try { await Jobs.enqueue(c.env, 'embed_entity', { type: 'research_doc', id }); } catch { /* the hourly sweep will catch it */ }
  }

  const row = await ownDoc(c.env, user.id, uid);
  return c.json(row ? dto(row) : { uid, title, index_state: 'pending' });
});

research.get('/documents/:uid/download', async (c) => {
  const user = await requireAuth(c);
  const row = await ownDoc(c.env, user.id, c.req.param('uid'));
  if (!row) return c.json({ detail: 'Not found' }, 404);
  // The shipped, audited path: one-time HMAC token, TTL clamped to 300s, jti
  // consumed in KV, every hit written to activity_logs by routes/files.ts.
  // Deliberately NOT an S3 presigned URL — wrangler.toml says why for this
  // bucket, and a bespoke stream here would be a second download path to
  // keep secure.
  const { token, expires_at } = await mintDownloadToken(c.env, {
    key: row.r2_key,
    audience: `research:${row.uid}`,
    userId: user.id,
    ttlSec: 120,
  });
  return c.json({ url: `/api/files/dl/${token}`, expires_at, name: row.title });
});

research.delete('/documents/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await ownDoc(c.env, user.id, c.req.param('uid'));
  // A CLIENT-SOURCED DOCUMENT CANNOT REACH THIS LINE, and that is the read-only
  // asymmetry rather than a missing check. `ownDoc` is `WHERE owner_user_id = ?`,
  // and a shared document is owned by the client — so its uid 404s here, and on
  // every other write path in this file, by construction. There is nothing to
  // guard because there is nothing to reach.
  if (!row) return c.json({ detail: 'Not found' }, 404);

  // VECTORS FIRST, and the order is the point: if the row went first, its
  // `chunk_count` would be gone and the chunk ids could never be named again,
  // leaving the document's text answerable after the document was deleted.
  await deleteChunkedEntity(c.env, 'research_doc', row.id, row.chunk_count);
  if (c.env.FILES) {
    try { await c.env.FILES.delete(row.r2_key); } catch (e) {
      console.warn('[research] R2 delete failed:', (e as Error).message);
    }
  }
  await c.env.DB.prepare('DELETE FROM research_documents WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

/**
 * `no_source` IS AN ANSWER, and it returns 200.
 *
 * An Ask box wired to a library that has nothing relevant will still answer if
 * you let it — from general knowledge, in the same confident voice a cited
 * answer uses. That is the single worst failure available on a research
 * surface and the reason a previous Ask tab was withdrawn. So the retrieval
 * runs first and the model is only called when there is something to quote.
 *
 * It is not an error status because it is not an error: the question was
 * understood, the library was searched, and the honest result is "nothing here
 * answers this". A 4xx would make the page render it as a failure.
 */
// ---------------------------------------------------------------------------
// Ask — and the session it is now kept in (migration 221)
// ---------------------------------------------------------------------------
//
// EVERY OUTCOME WRITES A ROW, including the two that produce no answer. The
// `pr1` artboard's third exchange is a question the library could not answer,
// kept on screen with the gap named — so `no_source` is a record, not a
// discard, and it is precisely what the `Unanswered` chip selects on.
// `model_unavailable` is stored apart from it because reporting a model
// outage as an empty library sends the reader to upload a document that would
// not have helped.

interface AskSessionRow {
  id: number; uid: string; owner_user_id: number;
  last_asked_at: string | null; created_at: string;
}

interface AskAnswerRow {
  id: number; uid: string; session_id: number; owner_user_id: number;
  question: string; answer: string | null; reason: string;
  best_score: number | null; score_floor: number | null; citations: string;
  model: string | null; prompt_tokens: number; completion_tokens: number;
  cached: number; cost_micro_usd: number; saved: number; created_at: string;
}

const answerDto = (r: AskAnswerRow) => ({
  uid: r.uid,
  question: r.question,
  answer: r.answer,
  reason: r.reason,
  best_score: r.best_score,
  score_floor: r.score_floor,
  // Stored as text, returned as the array the page renders. A malformed value
  // degrades to no citations rather than failing the whole thread — the answer
  // is still worth reading, and an exception here would take the session with it.
  citations: ((): unknown[] => {
    try {
      const parsed = JSON.parse(r.citations || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })(),
  model: r.model,
  prompt_tokens: r.prompt_tokens,
  completion_tokens: r.completion_tokens,
  cached: r.cached === 1,
  // Back to dollars at the boundary, so nothing above this line has to know
  // the storage unit. Six places is the unit's own resolution, not a rounding.
  cost_usd: r.cost_micro_usd / 1e6,
  saved: r.saved === 1,
  created_at: r.created_at,
});

/**
 * Totals for the header strip, counted over whatever slice is being returned.
 *
 * `answered` and `asked` are separate figures rather than one ratio because
 * the artboard prints "2 of 3" and a single number cannot say that. `no_source`
 * and `model_unavailable` are counted apart for the reason the store keeps
 * them apart.
 */
function askTotals(items: ReturnType<typeof answerDto>[]) {
  return {
    asked: items.length,
    answered: items.filter((i) => i.reason === 'answered').length,
    no_source: items.filter((i) => i.reason === 'no_source').length,
    model_unavailable: items.filter((i) => i.reason === 'model_unavailable').length,
    saved: items.filter((i) => i.saved).length,
    // Summed from the per-answer receipts, never re-derived from tokens and a
    // current rate: a price list that moves must not silently restate what a
    // past session cost. Summed in whole micro-dollars and divided once, so a
    // long session's total is not the accumulated error of N float additions.
    cost_usd: items.reduce((sum, i) => sum + Math.round((i.cost_usd || 0) * 1e6), 0) / 1e6,
  };
}

/** The caller's session by uid, or null. Owner-scoped like every read here. */
async function askSession(c: { env: Env }, userId: number, uid: string) {
  return c.env.DB.prepare(
    `SELECT * FROM research_ask_sessions WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, userId).first<AskSessionRow>();
}

/**
 * The session a question belongs to: the one named, else the caller's most
 * recent, else a new one.
 *
 * WHY IT FALLS BACK RATHER THAN 400-ing. A reader who lands on `/research/ask`
 * and types a question has no session uid to send, and demanding one would put
 * a "start a session" step in front of the only thing the page does. `New
 * session` is then a real act — it forces the next question into a fresh
 * thread — instead of the thing you must do before asking anything at all.
 */
async function resolveAskSession(c: { env: Env }, userId: number, wanted: string) {
  if (wanted) {
    const named = await askSession(c, userId, wanted);
    if (named) return named;
  }
  const latest = await c.env.DB.prepare(
    `SELECT * FROM research_ask_sessions WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(userId).first<AskSessionRow>();
  if (latest) return latest;
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_ask_sessions (uid, owner_user_id) VALUES (?, ?)`
  ).bind(uid, userId).run();
  return askSession(c, userId, uid) as Promise<AskSessionRow>;
}

/** Write one exchange and stamp its session. Returns the row's uid. */
async function recordAnswer(c: { env: Env }, session: AskSessionRow, row: {
  question: string; answer: string | null; reason: string;
  best_score: number | null; citations: unknown[];
  model?: string | null; prompt_tokens?: number; completion_tokens?: number;
  cached?: boolean; cost_usd?: number;
}) {
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_ask_answers
       (uid, session_id, owner_user_id, question, answer, reason, best_score, score_floor,
        citations, model, prompt_tokens, completion_tokens, cached, cost_micro_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, session.id, session.owner_user_id, row.question, row.answer, row.reason,
    row.best_score, SCORE_FLOOR, JSON.stringify(row.citations ?? []),
    row.model ?? null, Math.max(0, Math.round(row.prompt_tokens ?? 0)),
    Math.max(0, Math.round(row.completion_tokens ?? 0)),
    row.cached ? 1 : 0, Math.max(0, Math.round((row.cost_usd ?? 0) * 1e6)),
  ).run();
  await c.env.DB.prepare(
    `UPDATE research_ask_sessions SET last_asked_at = datetime('now') WHERE id = ?`
  ).bind(session.id).run();
  return uid;
}

/**
 * Start a thread. `New session` in the artboard's ops row, which was
 * `unbuilt: 'the question box below starts one'` — true of the box, and not of
 * the op: a box that always appends to the same thread cannot start a second.
 */
research.post('/ask/sessions', async (c) => {
  const user = await requireAuth(c);
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_ask_sessions (uid, owner_user_id) VALUES (?, ?)`
  ).bind(uid, user.id).run();
  const row = await askSession(c, user.id, uid);
  return c.json({ session: { uid, created_at: row?.created_at ?? null, last_asked_at: null }, items: [], totals: askTotals([]) }, 201);
});

/**
 * A thread, or the whole history, or the saved slice — the three chips, one
 * read.
 *
 * `scope=session` is the artboard's default (`This session`, selected). The
 * absent-session case returns an empty thread with a null uid rather than a
 * 404: a reader who has never asked anything has no session, and that is the
 * page's empty state, not an error.
 */
research.get('/ask/sessions', async (c) => {
  const user = await requireAuth(c);
  const scope = String(c.req.query('scope') || 'session');
  const wanted = String(c.req.query('session') || '');

  let session: AskSessionRow | null = null;
  if (wanted) {
    session = await askSession(c, user.id, wanted);
  } else {
    session = await c.env.DB.prepare(
      `SELECT * FROM research_ask_sessions WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(user.id).first<AskSessionRow>();
  }

  // THREE WHOLE STATEMENTS RATHER THAN ONE WITH A FRAGMENT SPLICED IN.
  // `check-sql-prepare` refuses a `${…}` inside a prepared query even when the
  // value is a literal chosen by a ternary, and it is right to: the next person
  // to add a fourth scope reaches for the same seam with a variable in hand.
  // The `saved = 1` predicate is written out where it applies.
  let rows: { results: AskAnswerRow[] };
  if (scope === 'saved') {
    rows = await c.env.DB.prepare(
      `SELECT * FROM research_ask_answers WHERE owner_user_id = ? AND saved = 1 ORDER BY id DESC LIMIT 200`
    ).bind(user.id).all<AskAnswerRow>();
  } else if (scope === 'all') {
    rows = await c.env.DB.prepare(
      `SELECT * FROM research_ask_answers WHERE owner_user_id = ? ORDER BY id DESC LIMIT 200`
    ).bind(user.id).all<AskAnswerRow>();
  } else if (session) {
    rows = await c.env.DB.prepare(
      `SELECT * FROM research_ask_answers WHERE session_id = ? AND owner_user_id = ? ORDER BY id ASC LIMIT 200`
    ).bind(session.id, user.id).all<AskAnswerRow>();
  } else {
    rows = { results: [] };
  }

  const items = (rows.results || []).map(answerDto);
  return c.json({
    scope,
    session: session ? { uid: session.uid, created_at: session.created_at, last_asked_at: session.last_asked_at } : null,
    items,
    totals: askTotals(items),
    // The count of sessions the reader has, so the page can say whether `All
    // history` would show anything this thread does not.
    score_floor: SCORE_FLOOR,
  });
});

/**
 * Keep or unkeep one answer — `Saved answers` in the ops row.
 *
 * A PATCH on the answer rather than a POST to a saved-answers collection,
 * because there is no second object: saving is one bit on a row the reader
 * already owns, and a collection endpoint would imply a list that can hold
 * something the history does not.
 */
research.patch('/ask/answers/:uid', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.saved !== 'boolean') return c.json({ detail: 'saved_required' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE research_ask_answers SET saved = ? WHERE uid = ? AND owner_user_id = ?`
  ).bind(body.saved ? 1 : 0, uid, user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_ask_answers WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<AskAnswerRow>();
  return c.json({ item: row ? answerDto(row) : null });
});

research.post('/ask', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const question = String(body?.question || '').trim().slice(0, 1000);
  if (!question) return c.json({ detail: 'question_required' }, 400);
  const session = await resolveAskSession(c, user.id, String(body?.session_uid || ''));

  const hits = await searchSemantic(c.env, question, {
    topK: 8,
    type: 'research_doc',
    namespace: researchNamespace(user.id),
    ownerUserId: user.id,
  });
  const usable = hits.filter((h) => h.score >= SCORE_FLOOR);

  if (!usable.length) {
    const indexed = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM research_documents WHERE owner_user_id = ? AND index_state = 'indexed'`
    ).bind(user.id).first<{ n: number }>();
    const best = hits.length ? Number(hits[0].score.toFixed(3)) : null;
    // Nothing was retrieved, so no model ran and nothing is charged. The row
    // records that as a zero rather than as an absent figure: "charged
    // nothing" is a fact about this question, and the strip's `No source` tile
    // says so beside it.
    const answer_uid = await recordAnswer(c, session, {
      question, answer: null, reason: 'no_source', best_score: best, citations: [],
    });
    return c.json({
      question,
      answer: null,
      reason: 'no_source',
      // The difference between "your library is empty" and "your library has
      // nothing on this" is the whole message, and the page renders each
      // differently.
      indexed_documents: indexed?.n ?? 0,
      best_score: best,
      score_floor: SCORE_FLOOR,
      citations: [],
      session_uid: session.uid,
      answer_uid,
      cost_usd: 0,
    });
  }

  const context = usable
    .map((h, i) => `[${i + 1}] ${h.title}\n${h.snippet}`)
    .join('\n\n');
  const prompt = [
    'Answer the question using ONLY the sources below.',
    'Cite sources by their bracketed number. If the sources do not contain the answer, say so plainly.',
    'Do not add facts that are not in the sources.',
    '',
    `Question: ${question}`,
    '',
    'Sources:',
    context,
  ].join('\n');

  let answer: string | null = null;
  let usage: { model?: string; prompt_tokens?: number; completion_tokens?: number; cached?: boolean; est_cost_usd?: number } | null = null;
  try {
    const out = await runAI(c.env, {
      task: 'research_ask',
      userId: user.id,
      // `text` rather than `messages`: the router hashes it for the cache key
      // and this task is uncached, but the shape is what every non-chat task
      // uses. The instructions live in the prompt itself so the retrieved
      // sources and the rules about them cannot drift apart.
      text: prompt,
      maxTokens: 700,
    });
    answer = out.ok && out.output ? out.output.trim() : null;
    // The router's own receipt, already written to `ai_usage_logs`. Taken
    // whether or not the answer arrived — a model that ran and returned
    // nothing still cost what it cost, and hiding that would make the session
    // total disagree with the admin dashboard.
    usage = out.usage || null;
  } catch (e) {
    console.error('[research] ask failed:', (e as Error).message);
  }

  const receipt = {
    model: usage?.model ?? null,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    cached: usage?.cached === true,
    cost_usd: usage?.est_cost_usd ?? 0,
  };

  if (!answer) {
    // The retrieval worked and the model did not. Reporting that as
    // `no_source` would blame the library for a failure that is not its.
    const citations = usable.map((h) => ({ title: h.title, chunk: h.chunk ?? null, score: Number(h.score.toFixed(3)) }));
    const answer_uid = await recordAnswer(c, session, {
      question, answer: null, reason: 'model_unavailable',
      best_score: Number(usable[0].score.toFixed(3)), citations, ...receipt,
    });
    return c.json({
      question, answer: null, reason: 'model_unavailable',
      citations,
      score_floor: SCORE_FLOOR,
      session_uid: session.uid,
      answer_uid,
      cost_usd: receipt.cost_usd,
    });
  }

  const citations = usable.map((h, i) => ({
    n: i + 1,
    title: h.title,
    chunk: h.chunk ?? null,
    score: Number(h.score.toFixed(3)),
  }));
  const answer_uid = await recordAnswer(c, session, {
    question, answer, reason: 'answered',
    best_score: Number(usable[0].score.toFixed(3)), citations, ...receipt,
  });

  return c.json({
    question,
    answer,
    reason: 'answered',
    citations,
    score_floor: SCORE_FLOOR,
    session_uid: session.uid,
    answer_uid,
    cost_usd: receipt.cost_usd,
  });
});


// ---------------------------------------------------------------------------
// Zone drafts — the AI band every Research and Network artboard ends with
// ---------------------------------------------------------------------------
//
// WHY `workspace_explain` AND NOT A NEW TASK CLASS. The band's work is read
// back what this page is showing and write one paragraph — which is the task
// `workspace_explain` already names, already has `alternates` and a model menu
// for, and is already registered as the `workspace` assist surface so the
// rail's model card is true for it. A `research_draft` class would be the same
// prompt under a second name, splitting `/api/ai/me/spend` into two figures for
// one kind of work. The task is the join key; it follows the work, not the URL.
//
// SURFACES ARE ALLOW-LISTED, AND THE LIST IS ONE ENTRY LONG ON PURPOSE. A
// surface here with no band mounted on it would be config for a page that
// cannot spend it — the failure `ui_assist_rail_and_sidebar` catches on the
// rail. Each artboard adds its own entry when its band lands.

interface ZoneDraftRow {
  id: number; uid: string; owner_user_id: number; surface: string;
  scope_key: string | null; body: string; model: string | null;
  cost_micro_usd: number; accepted_at: string | null; created_at: string;
}

const draftDto = (r: ZoneDraftRow) => ({
  uid: r.uid,
  surface: r.surface,
  scope_key: r.scope_key,
  body: r.body,
  model: r.model,
  cost_usd: r.cost_micro_usd / 1e6,
  accepted: r.accepted_at != null,
  accepted_at: r.accepted_at,
  created_at: r.created_at,
});

/**
 * What each surface drafts, and over what.
 *
 * `label` and `accept` are the artboard's own words for the band — they are
 * copy, and they live in the frontend beside the rest of the page's copy. What
 * is here is the part only the worker can hold: the instruction, and the reader
 * of the rows it is given.
 */
const DRAFT_SURFACES: Record<string, {
  instruction: string;
  gather: (c: { env: Env }, userId: number, scope: string) => Promise<string[]>;
}> = {
  'research/ask': {
    instruction: [
      'Write one short brief gathering the answers below into a single passage.',
      'Carry every bracketed citation through to the claim it supports.',
      'Name any question that went unanswered as a gap. Do not answer it.',
      'Add no fact that is not in the material below.',
    ].join(' '),
    // The session's own exchanges, in order. A question that came back with no
    // source is INCLUDED and marked — it is the gap the brief has to name, and
    // dropping it here would produce a brief that reads as though the session
    // answered everything it was asked.
    gather: async (c, userId, scope) => {
      const session = scope
        ? await c.env.DB.prepare(
            `SELECT id FROM research_ask_sessions WHERE uid = ? AND owner_user_id = ?`
          ).bind(scope, userId).first<{ id: number }>()
        : await c.env.DB.prepare(
            `SELECT id FROM research_ask_sessions WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1`
          ).bind(userId).first<{ id: number }>();
      if (!session) return [];
      const rows = await c.env.DB.prepare(
        `SELECT question, answer, reason, citations FROM research_ask_answers
          WHERE session_id = ? AND owner_user_id = ? ORDER BY id ASC LIMIT 50`
      ).bind(session.id, userId).all<{ question: string; answer: string | null; reason: string; citations: string }>();
      return (rows.results || []).map((r) => {
        if (r.reason !== 'answered') return `Q: ${r.question}\nA: (no retrievable source — unanswered)`;
        let cites = '';
        try {
          const list = JSON.parse(r.citations || '[]');
          if (Array.isArray(list) && list.length) {
            cites = `\nSources: ${list.map((x: any) => `[${x.n}] ${x.title}`).join(', ')}`;
          }
        } catch { /* a malformed citation list costs the brief its sources, not its answer */ }
        return `Q: ${r.question}\nA: ${r.answer}${cites}`;
      });
    },
  },
};

research.get('/drafts', async (c) => {
  const user = await requireAuth(c);
  const surface = String(c.req.query('surface') || '');
  if (!DRAFT_SURFACES[surface]) return c.json({ detail: 'unknown_surface' }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_zone_drafts WHERE owner_user_id = ? AND surface = ? ORDER BY id DESC LIMIT 20`
  ).bind(user.id, surface).all<ZoneDraftRow>();
  return c.json({ items: (rows.results || []).map(draftDto) });
});

/**
 * Draft one. NOTHING RUNS ON MOUNT — this is a POST behind a button, for the
 * reason `ValidateProposals` states in its own docblock: a component that
 * proposed on render would spend a reader's budget for visiting a page.
 */
research.post('/drafts', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const surface = String(body?.surface || '');
  const spec = DRAFT_SURFACES[surface];
  if (!spec) return c.json({ detail: 'unknown_surface' }, 400);
  const scope = String(body?.scope_key || '');

  const material = await spec.gather(c, user.id, scope);
  // NOTHING TO READ IS NOT AN ERROR AND MUST NOT REACH THE MODEL. A brief over
  // an empty session would be written from the model's own knowledge in exactly
  // the voice a grounded one uses — the failure `/ask` refuses by retrieving
  // first, and the same refusal belongs here.
  if (!material.length) return c.json({ detail: 'nothing_to_draft' }, 409);

  let out;
  try {
    out = await runAI(c.env, {
      task: 'workspace_explain',
      userId: user.id,
      text: `${spec.instruction}\n\n${material.join('\n\n')}`,
      maxTokens: 500,
    });
  } catch (e) {
    console.error('[research] draft failed:', (e as Error).message);
    return c.json({ detail: 'draft_unavailable' }, 503);
  }
  const text = out.ok && out.output ? out.output.trim() : '';
  if (!text) return c.json({ detail: 'draft_unavailable' }, 503);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body, model, cost_micro_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, user.id, surface, scope || null, text,
    out.usage?.model ?? null, Math.max(0, Math.round((out.usage?.est_cost_usd ?? 0) * 1e6)),
  ).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<ZoneDraftRow>();
  return c.json({ item: row ? draftDto(row) : null }, 201);
});

/**
 * Accept it, having optionally edited it first — the artboard's `Accept …` and
 * `Edit first` are one write, because editing then accepting is the same act
 * with a different body. A `body` that arrives is the reader's version and
 * replaces the drafted one; the receipt does not change, since the run is what
 * was charged.
 */
research.patch('/drafts/:uid', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const body = await c.req.json().catch(() => ({} as any));
  const edited = typeof body?.body === 'string' ? body.body.trim().slice(0, 8000) : null;
  if (edited !== null && !edited) return c.json({ detail: 'body_empty' }, 400);

  if (edited) {
    await c.env.DB.prepare(
      `UPDATE research_zone_drafts SET body = ?, accepted_at = datetime('now') WHERE uid = ? AND owner_user_id = ?`
    ).bind(edited, uid, user.id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE research_zone_drafts SET accepted_at = datetime('now') WHERE uid = ? AND owner_user_id = ?`
    ).bind(uid, user.id).run();
  }
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<ZoneDraftRow>();
  if (!row) return c.json({ detail: 'not_found' }, 404);
  return c.json({ item: draftDto(row) });
});

/** Discard. The row goes; see the migration's note on why there is no third state. */
research.delete('/drafts/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Funds — founder-facing fund research (migration 216)
// ---------------------------------------------------------------------------
//
// EVERY READ IS OWNER-SCOPED, like the library above and for the same reason:
// a founder's shortlist, their notes on a partner, and above all their record
// of who passed and why are not things another account may read. There is no
// cross-user listing in this section by construction.

const FUND_STAGE_FIT = new Set(['right', 'wrong']);
const FUND_PATH = new Set(['warm', 'cold']);
const FUND_STATUS = new Set(['researching', 'passed']);

interface FundRow {
  id: number; uid: string; owner_user_id: number; project_id: number | null;
  name: string; cheque_min_cents: number | null; cheque_max_cents: number | null;
  stage_fit: string | null; path: string | null; status: string;
  pass_reason: string | null; thesis: string | null; note: string | null;
  source_url: string | null; created_at: string; updated_at: string;
}

const fundDto = (r: FundRow) => ({
  uid: r.uid,
  name: r.name,
  // NULL is not zero. A cheque range nobody recorded is not a fund that writes
  // nothing, and the zone renders it as unrecorded.
  cheque_min_cents: r.cheque_min_cents,
  cheque_max_cents: r.cheque_max_cents,
  // NULL is not 'wrong'. "Not yet assessed" and "does not write at our stage"
  // are different facts and must never render the same way.
  stage_fit: r.stage_fit,
  path: r.path,
  status: r.status,
  pass_reason: r.pass_reason,
  thesis: r.thesis,
  note: r.note,
  source_url: r.source_url,
  created_at: r.created_at,
});

const clampText = (v: unknown, max: number): string | null => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};
const clampInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const oneOf = (v: unknown, set: Set<string>): string | null => {
  const t = String(v ?? '').trim().toLowerCase();
  return set.has(t) ? t : null;
};

research.get('/funds', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_funds WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(user.id).all<FundRow>();
  const items = (rows.results || []).map(fundDto);

  // The cheque-overlap figure the canvas asks for needs the size of the round
  // being raised, and that lives on the project rather than here. When no
  // target is recorded the answer is not zero — it is that the question cannot
  // be asked yet, and the response says which.
  // NARROWED BY THE ACTIVE COMPANY, not by founder ownership alone. A founder
  // with two companies raising two different rounds would otherwise get
  // whichever project was touched last, and every fund on this page would be
  // measured against the wrong ask — one company's data on another company's
  // screen, which is the rule `companyScope` exists to hold. It is also the
  // only project read in this file, and `company_switcher.test.mjs` caught it
  // reading unscoped before this comment existed.
  const companyId = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  const scope = companyScope(user, companyId, 'p');
  const target = await c.env.DB.prepare(
    `SELECT p.raise_target_usd FROM projects p
      WHERE ${scope.sql} AND p.raise_target_usd IS NOT NULL
      ORDER BY p.updated_at DESC LIMIT 1`
  ).bind(...scope.binds).first<{ raise_target_usd: number }>().catch(() => null);

  const askCents = target?.raise_target_usd ? Math.round(Number(target.raise_target_usd) * 100) : null;
  const overlaps = askCents === null ? null : items.filter((f) => {
    if (f.cheque_min_cents === null && f.cheque_max_cents === null) return false;
    const lo = f.cheque_min_cents ?? 0;
    const hi = f.cheque_max_cents ?? Number.MAX_SAFE_INTEGER;
    return askCents >= lo && askCents <= hi;
  }).length;

  return c.json({
    items,
    researched_count: items.length,
    right_stage_count: items.filter((f) => f.stage_fit === 'right').length,
    warm_path_count: items.filter((f) => f.path === 'warm').length,
    passed_count: items.filter((f) => f.status === 'passed').length,
    // A pass with no reason is indistinguishable from a fund nobody reached,
    // which is the whole thing recording a pass is meant to prevent.
    passed_without_reason: items.filter((f) => f.status === 'passed' && !f.pass_reason).length,
    cheque_overlap_count: overlaps,
    cheque_overlap_note: askCents === null
      ? 'No raise target is recorded on the active company\'s project, so there is no ask to compare a cheque range against. The count is absent rather than zero.'
      : null,
  });
});

research.post('/funds', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const name = clampText(body.name, 200);
  if (!name) return c.json({ detail: 'A fund needs a name' }, 400);
  const uid = newUid();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO research_funds
       (uid, owner_user_id, project_id, name, cheque_min_cents, cheque_max_cents,
        stage_fit, path, status, pass_reason, thesis, note, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, user.id, clampInt(body.project_id), name,
    clampInt(body.cheque_min_cents), clampInt(body.cheque_max_cents),
    oneOf(body.stage_fit, FUND_STAGE_FIT), oneOf(body.path, FUND_PATH),
    oneOf(body.status, FUND_STATUS) || 'researching',
    clampText(body.pass_reason, 1000), clampText(body.thesis, 2000),
    clampText(body.note, 2000), clampText(body.source_url, 500), now, now,
  ).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_funds WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<FundRow>();
  return c.json(fundDto(row as FundRow), 201);
});

research.patch('/funds/:uid', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const existing = await c.env.DB.prepare(
    `SELECT * FROM research_funds WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<FundRow>();
  if (!existing) return c.json({ detail: 'Not found' }, 404);
  const b = await c.req.json<any>().catch(() => ({}));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const next = {
    name: has('name') ? (clampText(b.name, 200) || existing.name) : existing.name,
    cheque_min_cents: has('cheque_min_cents') ? clampInt(b.cheque_min_cents) : existing.cheque_min_cents,
    cheque_max_cents: has('cheque_max_cents') ? clampInt(b.cheque_max_cents) : existing.cheque_max_cents,
    stage_fit: has('stage_fit') ? oneOf(b.stage_fit, FUND_STAGE_FIT) : existing.stage_fit,
    path: has('path') ? oneOf(b.path, FUND_PATH) : existing.path,
    status: has('status') ? (oneOf(b.status, FUND_STATUS) || existing.status) : existing.status,
    pass_reason: has('pass_reason') ? clampText(b.pass_reason, 1000) : existing.pass_reason,
    thesis: has('thesis') ? clampText(b.thesis, 2000) : existing.thesis,
    note: has('note') ? clampText(b.note, 2000) : existing.note,
    source_url: has('source_url') ? clampText(b.source_url, 500) : existing.source_url,
  };
  await c.env.DB.prepare(
    `UPDATE research_funds
        SET name = ?, cheque_min_cents = ?, cheque_max_cents = ?, stage_fit = ?, path = ?,
            status = ?, pass_reason = ?, thesis = ?, note = ?, source_url = ?, updated_at = ?
      WHERE uid = ? AND owner_user_id = ?`
  ).bind(
    next.name, next.cheque_min_cents, next.cheque_max_cents, next.stage_fit, next.path,
    next.status, next.pass_reason, next.thesis, next.note, next.source_url, nowIso(),
    uid, user.id,
  ).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_funds WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<FundRow>();
  return c.json(fundDto(row as FundRow));
});

research.delete('/funds/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_funds WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Benchmarks (migration 217)
// ---------------------------------------------------------------------------

interface BenchRow {
  id: number; uid: string; owner_user_id: number; metric: string;
  our_value: string | null; peer_value: string | null; peer_source: string | null;
  peer_sample_size: number | null; peer_as_of: string | null; reading: string | null;
  created_at: string; updated_at: string;
}

const benchDto = (r: BenchRow) => ({
  uid: r.uid,
  metric: r.metric,
  our_value: r.our_value,
  peer_value: r.peer_value,
  peer_source: r.peer_source,
  peer_sample_size: r.peer_sample_size,
  peer_as_of: r.peer_as_of,
  reading: r.reading,
  // Derived, not stored: a row is only a COMPARISON when the peer figure has
  // its base. Without it the row is a metric being tracked, which is a
  // different and lesser claim, and the zone renders the two differently.
  is_comparison: Boolean(r.peer_value && r.peer_source && r.peer_sample_size),
  created_at: r.created_at,
});

research.get('/benchmarks', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_benchmarks WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(user.id).all<BenchRow>();
  const items = (rows.results || []).map(benchDto);
  const compared = items.filter((b) => b.is_comparison);
  const smallest = compared.length
    ? Math.min(...compared.map((b) => Number(b.peer_sample_size)))
    : null;
  return c.json({
    items,
    metric_count: items.length,
    comparison_count: compared.length,
    unread_count: items.filter((b) => !b.reading).length,
    // The base of the weakest comparison on the page, stated rather than left
    // for a reader to find by opening every row. A peer median over four funds
    // and one over four hundred are not the same evidence.
    smallest_sample_size: smallest,
    sample_note: smallest !== null && smallest < 10
      ? `The smallest peer set behind a comparison here is ${smallest}. A median over a set that size moves with one member and should not be presented as a market rate.`
      : null,
  });
});

research.post('/benchmarks', async (c) => {
  const user = await requireAuth(c);
  const b = await c.req.json<any>().catch(() => ({}));
  const metric = clampText(b.metric, 200);
  if (!metric) return c.json({ detail: 'A benchmark needs a metric' }, 400);
  const peerValue = clampText(b.peer_value, 100);
  const peerSource = clampText(b.peer_source, 300);
  const peerSample = clampInt(b.peer_sample_size);
  // The schema CHECK would reject this too. Refusing here as well turns a
  // constraint violation into a sentence the writer can act on.
  if (peerValue && (!peerSource || peerSample === null)) {
    return c.json({
      detail: 'A peer figure needs its source and its sample size. A benchmark presented '
        + 'without its base is arithmetic wearing a metric’s clothes.',
    }, 400);
  }
  const uid = newUid();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO research_benchmarks
       (uid, owner_user_id, metric, our_value, peer_value, peer_source,
        peer_sample_size, peer_as_of, reading, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, user.id, metric, clampText(b.our_value, 100), peerValue, peerSource,
    peerSample, clampText(b.peer_as_of, 40), clampText(b.reading, 2000), now, now,
  ).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_benchmarks WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<BenchRow>();
  return c.json(benchDto(row as BenchRow), 201);
});

research.delete('/benchmarks/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_benchmarks WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Diligence — NO NEW STORE. Room access, read from the investor's side.
// ---------------------------------------------------------------------------
//
// The investor canvas (Pages · Investor Research, IR2) heads this
// `['Company','Scope','State','Deal stage','Founder activity']` over a "Rooms
// granted" count, and every one of those already exists: `data_room_grants` is
// the grant, `data_room_files.visibility` is the scope the founder actually
// staged, and `data_room_access_log` is the activity. So this zone needed no
// migration — it needed assembling, which is what the zone's own card
// suspected when it said folding diligence in here "is a routing decision that
// has not been made".
//
// SCOPE REPORTS WHAT WAS STAGED, NOT WHAT WAS ASKED FOR. The canvas's own
// reading, kept: "Kelp Bio reads 6 of 11 — the IP folder has survived two asks,
// and that became the IC condition on the deal. What is absent from a room is
// diligence information too." So the response returns both numbers and never
// the ratio alone.

research.get('/diligence', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT g.uid AS grant_uid, g.created_at, g.expires_at,
            p.uid AS project_uid, p.name AS project_name,
            (SELECT COUNT(*) FROM data_room_files f WHERE f.project_id = g.project_id) AS file_total,
            (SELECT COUNT(*) FROM data_room_files f
              WHERE f.project_id = g.project_id AND f.visibility = 'open') AS file_open,
            (SELECT MAX(l.created_at) FROM data_room_access_log l
              WHERE l.project_id = g.project_id AND l.user_id = ?) AS last_opened_at
       FROM data_room_grants g
       JOIN projects p ON p.id = g.project_id
      WHERE g.investor_user_id = ? AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
      ORDER BY g.created_at DESC LIMIT 200`
  ).bind(user.id, user.id).all<any>();

  const items = (rows.results || []).map((r: any) => ({
    grant_uid: r.grant_uid,
    project_uid: r.project_uid,
    project_name: r.project_name,
    // Two numbers, never one ratio: what is absent from a room is diligence
    // information too, and a percentage hides which rooms are thin.
    file_open: Number(r.file_open || 0),
    file_total: Number(r.file_total || 0),
    withheld_behind_nda: Number(r.file_total || 0) - Number(r.file_open || 0),
    last_opened_at: r.last_opened_at ?? null,
    expires_at: r.expires_at ?? null,
    created_at: r.created_at,
  }));

  return c.json({
    items,
    granted_count: items.length,
    // Rooms where the founder staged less than everything they hold. Not a
    // complaint — it is the signal the zone exists to surface.
    partial_count: items.filter((r) => r.withheld_behind_nda > 0).length,
    // Deal stage is on the canvas and is NOT joined here. A grant is between a
    // founder and an investor; a deal is a separate record that may or may not
    // exist for the same company, and joining them on a name rather than a key
    // would attach a stage to the wrong room. Stated rather than guessed.
    deal_stage: null,
    deal_stage_note: 'A data-room grant and a deal are separate records with no key between them, '
      + 'so no deal stage is attached to a room here. Opening the deal shows its own stage.',
  });
});

export default research;

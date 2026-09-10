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
import { companyScope, esignEnvelopeScope } from '../services/tenancyScope';
import { scopedDecisions } from './ic';
import { investorProjectIds } from './_investorProjectScope';
import { ACTIVE_COMPANY_HEADER, resolveActiveCompany } from '../middleware/activeCompany';
// The perk lifecycle window lives in ONE place. `offers/perk-deals`'s gather
// below decides what is expiring, and it has to agree with what the zone shows
// a reader — so it imports the same helper the partner listing serves from
// rather than repeating thirty days here.
import { perkLifecycle } from './perks';
// The snapshot table gains its board-reporting columns lazily rather than in a
// migration (`progress.ts:1650`), so a reader that goes straight to SELECT can
// hit a table that is one deploy behind the columns it names. Every consumer
// calls this first; the KPI draft surface is a consumer.
import { ensureMetricsSnapshotsSchema } from './progress';
import { todayIso } from './_t13t14t15_helpers';

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
// Market readings — comparable ranges for the firm's own service lines (223)
// ---------------------------------------------------------------------------
//
// THE ROWS ARE THE CATALOG, joined to the newest reading for each. An offering
// with no reading is the artboard's "never run" row and its `Retainer rate ·
// Not recorded` tile — a fact about the firm's own record, which is why it is
// returned rather than filtered out.

interface ReadingRow {
  id: number; uid: string; owner_user_id: number; offering_id: number | null;
  metric: string; range_low_cents: number; range_high_cents: number;
  comparable_count: number; ran_at: string; scope: string | null;
  created_at: string; updated_at: string;
}

const readingDto = (r: ReadingRow) => ({
  uid: r.uid,
  offering_uid: null as string | null,
  metric: r.metric,
  range_low_cents: r.range_low_cents,
  range_high_cents: r.range_high_cents,
  comparable_count: r.comparable_count,
  ran_at: r.ran_at,
  scope: r.scope,
});

/**
 * Every service line, with the newest reading for it — and every reading that
 * is not for a service line.
 *
 * TWO READS RATHER THAN ONE OUTER JOIN, because the interesting row is the one
 * with nothing on the other side and an outer join makes that row's absence
 * indistinguishable from a row that was never selected. The page needs both
 * halves named.
 */
research.get('/market-readings', async (c) => {
  const user = await requireAuth(c);
  const offerings = await c.env.DB.prepare(
    `SELECT id, uid, title, price_usd FROM service_offerings
      WHERE owner_user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all<{ id: number; uid: string; title: string; price_usd: number | null }>();
  const readings = await c.env.DB.prepare(
    `SELECT * FROM research_market_readings WHERE owner_user_id = ? ORDER BY ran_at DESC LIMIT 500`
  ).bind(user.id).all<ReadingRow>();

  // Newest first out of the query, so the first one seen per offering is the
  // newest — no comparison, no tie-break, no chance of picking the wrong run.
  const newest = new Map<number, ReadingRow>();
  const loose: ReadingRow[] = [];
  for (const r of readings.results || []) {
    if (r.offering_id == null) { loose.push(r); continue; }
    if (!newest.has(r.offering_id)) newest.set(r.offering_id, r);
  }

  const items = [
    ...(offerings.results || []).map((o) => {
      const r = newest.get(o.id);
      return {
        offering_uid: o.uid,
        metric: o.title,
        // NULL, NOT ZERO, AND THIS IS THE ROW THE ARTBOARD IS ABOUT. A service
        // line nobody has priced the market for reads "Not recorded"; a zero
        // would say the firm looked and found the work is worth nothing.
        ...(r ? { ...readingDto(r), offering_uid: o.uid, metric: o.title } : {
          uid: null, range_low_cents: null, range_high_cents: null,
          comparable_count: null, ran_at: null, scope: null,
        }),
        // The catalog's own price, so the page can say when a service line is
        // unpriced AND unread — the two halves of the same gap.
        catalogued: o.price_usd != null,
      };
    }),
    ...loose.map((r) => ({ ...readingDto(r), catalogued: false })),
  ];
  return c.json({ items });
});

research.post('/market-readings', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const low = Number(body?.range_low_cents);
  const high = Number(body?.range_high_cents);
  const n = Number(body?.comparable_count);
  const ranAt = String(body?.ran_at || '').trim().slice(0, 32);
  let metric = String(body?.metric || '').trim().slice(0, 200);

  let offeringId: number | null = null;
  if (body?.offering_uid) {
    const o = await c.env.DB.prepare(
      `SELECT id, title FROM service_offerings WHERE uid = ? AND owner_user_id = ?`
    ).bind(String(body.offering_uid), user.id).first<{ id: number; title: string }>();
    if (!o) return c.json({ detail: 'not_found' }, 404);
    offeringId = o.id;
    // The offering's own title, so a reading cannot be filed under a name the
    // catalog does not use — the page joins the two and a second label would be
    // the place they disagree.
    metric = o.title;
  }
  if (!metric) return c.json({ detail: 'metric_required' }, 400);
  // EVERY ONE OF THESE IS REFUSED RATHER THAN DEFAULTED. A range with no
  // comparable count is a number a client will ask about and the firm cannot
  // answer; a range with no run date cannot age, and age is what this zone
  // gates attachment on. `research_benchmarks` refuses a peer figure on exactly
  // these grounds and its schema carries the same CHECK.
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high < low) {
    return c.json({ detail: 'range_required' }, 400);
  }
  if (!Number.isInteger(n) || n < 1) return c.json({ detail: 'comparable_count_required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ranAt)) return c.json({ detail: 'ran_at_required' }, 400);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_market_readings
       (uid, owner_user_id, offering_id, metric, range_low_cents, range_high_cents, comparable_count, ran_at, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uid, user.id, offeringId, metric, low, high, n, ranAt,
    body?.scope ? String(body.scope).slice(0, 200) : null).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_market_readings WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<ReadingRow>();
  return c.json({ item: row ? readingDto(row) : null }, 201);
});

research.delete('/market-readings/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_market_readings WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Brief notes — the firm's own half of a client brief (migration 222)
// ---------------------------------------------------------------------------
//
// THE SECOND SOURCE. `ClientPrepZone`'s rows are all `source: 'client'` — the
// founder's record, quoted — so the `pr2` artboard's `Ours only` chip matched
// nothing and `Founder-sourced` matched everything. These are the rows that
// make the axis real, and `open` is the fourth chip: only a note the firm wrote
// can be marked settled, because ticking off a fact the CLIENT recorded would
// be editing someone else's record.

interface BriefNoteRow {
  id: number; uid: string; owner_user_id: number; project_id: number;
  section: string; body: string; open: number; created_at: string; updated_at: string;
}

const noteDto = (r: BriefNoteRow) => ({
  uid: r.uid,
  section: r.section,
  body: r.body,
  open: r.open === 1,
  // The axis the chips filter on. Stated by the route so the page never has to
  // decide what its own rows are — the brief's other rows say `'client'` and
  // these say `'ours'`, and one place decides both.
  source: 'ours' as const,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/**
 * The project a note may be written against: one the caller holds a LIVE grant
 * over.
 *
 * A firm that never held a grant has no business keeping a file on that founder
 * inside this product, and a revoked grant is the founder taking that back —
 * which is why the check is on `status = 'active'` and not merely on the grant
 * having once existed. Returns the project's id, or null.
 */
async function grantedProjectId(c: { env: Env }, userId: number, projectUid: string) {
  const row = await c.env.DB.prepare(
    `SELECT p.id AS id
       FROM advisor_client_grants g
       JOIN projects p ON p.id = g.project_id
      WHERE g.advisor_user_id = ? AND g.status = 'active' AND p.uid = ?
      ORDER BY g.id DESC LIMIT 1`
  ).bind(userId, projectUid).first<{ id: number }>();
  return row?.id ?? null;
}

research.get('/brief-notes', async (c) => {
  const user = await requireAuth(c);
  const projectUid = String(c.req.query('project') || '');
  if (!projectUid) return c.json({ detail: 'project_required' }, 400);
  const projectId = await grantedProjectId(c, user.id, projectUid);
  // NOT FOUND RATHER THAN FORBIDDEN, and deliberately: whether a given founder
  // exists is not something a firm without a grant may learn by probing.
  if (!projectId) return c.json({ detail: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE owner_user_id = ? AND project_id = ? ORDER BY id ASC LIMIT 200`
  ).bind(user.id, projectId).all<BriefNoteRow>();
  return c.json({ items: (rows.results || []).map(noteDto) });
});

research.post('/brief-notes', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const projectUid = String(body?.project || '');
  const section = String(body?.section || '').trim().slice(0, 120);
  const text = String(body?.body || '').trim().slice(0, 4000);
  if (!projectUid || !section || !text) return c.json({ detail: 'section_and_body_required' }, 400);
  const projectId = await grantedProjectId(c, user.id, projectUid);
  if (!projectId) return c.json({ detail: 'not_found' }, 404);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO research_brief_notes (uid, owner_user_id, project_id, section, body, open)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(uid, user.id, projectId, section, text, body?.open === false ? 0 : 1).run();
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, user.id).first<BriefNoteRow>();
  return c.json({ item: row ? noteDto(row) : null }, 201);
});

/** Settle a note, or reopen it. The only field the artboard's chips act on. */
research.patch('/brief-notes/:uid', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.open !== 'boolean') return c.json({ detail: 'open_required' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE research_brief_notes SET open = ?, updated_at = datetime('now')
      WHERE uid = ? AND owner_user_id = ?`
  ).bind(body.open ? 1 : 0, c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).first<BriefNoteRow>();
  return c.json({ item: row ? noteDto(row) : null });
});

research.delete('/brief-notes/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attachments — `Attach to proposal`, on two artboards (migration 222)
// ---------------------------------------------------------------------------
//
// The op was `unbuilt:` on both Client prep and Market for the want of an EDGE,
// never for the want of a proposal: `quotes` is live and `api.myQuotes()` reads
// it. One table serves both, keyed by `kind`.

const ATTACH_KINDS = new Set(['brief', 'reading']);

interface AttachmentRow {
  id: number; uid: string; owner_user_id: number; kind: string;
  ref_key: string; quote_id: number; created_at: string;
}

research.get('/attachments', async (c) => {
  const user = await requireAuth(c);
  const kind = String(c.req.query('kind') || '');
  if (!ATTACH_KINDS.has(kind)) return c.json({ detail: 'unknown_kind' }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM research_attachments WHERE owner_user_id = ? AND kind = ? ORDER BY id DESC LIMIT 500`
  ).bind(user.id, kind).all<AttachmentRow>();
  return c.json({
    items: (rows.results || []).map((r) => ({
      uid: r.uid, kind: r.kind, ref_key: r.ref_key, quote_id: r.quote_id, created_at: r.created_at,
    })),
  });
});

research.post('/attachments', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const kind = String(body?.kind || '');
  const refKey = String(body?.ref_key || '').trim().slice(0, 200);
  const quoteId = Number(body?.quote_id);
  if (!ATTACH_KINDS.has(kind) || !refKey || !Number.isInteger(quoteId)) {
    return c.json({ detail: 'kind_ref_and_quote_required' }, 400);
  }
  // THE QUOTE MUST BE THE CALLER'S OWN. Attaching a market reading to somebody
  // else's proposal would put the firm's reasoning behind a number they did not
  // quote — and would tell them a figure exists that they cannot see.
  const quote = await c.env.DB.prepare(
    `SELECT id FROM quotes WHERE id = ? AND provider_user_id = ?`
  ).bind(quoteId, user.id).first<{ id: number }>();
  if (!quote) return c.json({ detail: 'not_found' }, 404);

  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO research_attachments (uid, owner_user_id, kind, ref_key, quote_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(uid, user.id, kind, refKey, quoteId).run();
  // `OR IGNORE` because attaching the same thing to the same proposal twice is
  // not a second fact — the row's own UNIQUE says so — and a 409 here would
  // make a reader think the first attachment had failed.
  const row = await c.env.DB.prepare(
    `SELECT * FROM research_attachments
      WHERE owner_user_id = ? AND kind = ? AND ref_key = ? AND quote_id = ?`
  ).bind(user.id, kind, refKey, quoteId).first<AttachmentRow>();
  return c.json({ item: row ? { uid: row.uid, kind: row.kind, ref_key: row.ref_key, quote_id: row.quote_id, created_at: row.created_at } : null }, 201);
});

research.delete('/attachments/:uid', async (c) => {
  const user = await requireAuth(c);
  const res = await c.env.DB.prepare(
    `DELETE FROM research_attachments WHERE uid = ? AND owner_user_id = ?`
  ).bind(c.req.param('uid'), user.id).run();
  if (!res.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  return c.json({ ok: true });
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
/**
 * The project a FOUNDER draft surface is allowed to read, or null.
 *
 * Every surface above this line belongs to a partner and scopes on
 * `users.partner_id`. The founder surfaces below scope on a PROJECT, and the
 * `gather` signature hands them a user id rather than the `User` row — so
 * `ownedProjectScope` in `contacts.ts`, which keys off `user.founder_id`, is
 * not reachable from here. This is the same check written for the id: the
 * project must belong to a founder record that belongs to this user, and it
 * must not be deleted.
 *
 * IT IS THE ONLY THING BETWEEN ONE FOUNDER'S DRAFT AND ANOTHER'S RECORDS.
 * `/research/drafts` authorises on `requireAuth` alone and delegates the
 * scoping to each surface, which is what makes the mechanism role-agnostic —
 * and what makes a gather that forgets to scope a cross-account read rather
 * than a bug on one page. `scope` is the caller's `scopeKey`, so it is
 * attacker-controlled by construction; nothing here trusts it beyond using it
 * as a candidate id.
 *
 * THE LINK IS `users.founder_id`, NOT A COLUMN ON `founders`. An earlier draft
 * joined `founders f ON f.id = p.founder_id WHERE f.user_id = ?`, which reads
 * plausibly and names a column that has never existed — `founders` carries
 * `uid`, `name` and `email`, and the account behind it is found the other way
 * round. `schema_guards` caught it; a unit test could not, because its harness
 * had invented the column to match.
 *
 * OWNERSHIP, NOT ACTIVE COMPANY. `ownedProjectScope` in `contacts.ts` also
 * narrows to the founder's active company, which needs the request headers and
 * a full Hono context; `gather` is handed `{ env }` alone. Ownership is the
 * security property and it is enforced here — the company facet only decides
 * which of the founder's OWN startups is in view, and the desk passes the
 * project id it is already showing.
 *
 * With no scope the founder's single project is used, and a founder with more
 * than one gets null rather than an arbitrary pick: a draft written about the
 * wrong startup is worse than no draft.
 */
async function founderProject(
  c: { env: Env }, userId: number, scope: string,
): Promise<number | null> {
  const owned = await c.env.DB.prepare(
    `SELECT p.id FROM projects p
       JOIN users u ON u.founder_id = p.founder_id
      WHERE u.id = ? AND p.deleted_at IS NULL
      ORDER BY p.id`
  ).bind(userId).all<{ id: number }>();
  const ids = (owned.results || []).map((r) => Number(r.id));
  if (!ids.length) return null;
  // A SCOPE KEY THAT WAS SENT MUST RESOLVE OR REFUSE — it may never fall
  // through to the lone-project branch below. An earlier draft tested
  // `Number.isFinite(Number(scope))` first, so `scope_key: "null"`, or any
  // other unparseable string, read as "no scope key was sent" and drafted over
  // whatever single project the caller happened to own. That is a draft about
  // a startup nobody asked about, produced by a request that named one.
  if (scope !== '') {
    const asked = Number(scope);
    return Number.isInteger(asked) && ids.includes(asked) ? asked : null;
  }
  return ids.length === 1 ? ids[0] : null;
}

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

  // ── THE FIVE THAT WERE MOUNTED AND NOT ALLOW-LISTED ──────────────────────
  //
  // `research/ask` stood here alone while `ZoneDraft` was mounted on five more
  // zones, and the failure was silent in exactly the way this file's own rules
  // are written against. `GET /drafts` 400s an unknown surface; the band
  // catches and renders its empty state, which is indistinguishable from "no
  // draft yet". So five artboards showed their AI band, their cost line and
  // their run button, and the button 400'd. The band is config that follows a
  // mount — and a mount without its config is a control that does nothing.
  //
  // EVERY `gather` READS THE ZONE'S OWN ROWS AND NOTHING ELSE. That is what
  // makes the drafts grounded rather than written from the model's knowledge in
  // the voice of a grounded one, and it is why each returns `[]` rather than a
  // placeholder when there is nothing: `POST /drafts` turns an empty gather into
  // a 409 that never reaches the model.

  'research/library': {
    // The artboard: "Points to the unindexed document and what it would unlock
    // in Ask". So the material is the index state, and the instruction forbids
    // the one thing a model would otherwise volunteer — guessing at what a
    // document it has never read contains.
    instruction: [
      'List which documents are not indexed and are therefore invisible to Ask.',
      'For each, name the document by its title and say only what its title and kind state.',
      'Do not speculate about contents. If every document is indexed, say so in one line.',
    ].join(' '),
    gather: async (c, userId) => {
      const rows = await c.env.DB.prepare(
        `SELECT title, kind, index_state, chunk_count FROM research_documents
          WHERE owner_user_id = ? ORDER BY id DESC LIMIT 60`
      ).bind(userId).all<{ title: string; kind: string; index_state: string; chunk_count: number }>();
      return (rows.results || []).map((r) =>
        `${r.title} — filed as ${r.kind}; index state ${r.index_state}; ${r.chunk_count || 0} passages readable by Ask`);
    },
  },

  'research/client-prep': {
    // The artboard: "keeping founder-sourced facts attributed to Verwood and
    // firm-written facts to the firm". The seam is the whole point of this zone,
    // so it is in the instruction and it is in every line of the material.
    instruction: [
      'Draft a one-page checkpoint brief from the rows below.',
      'Keep each fact attributed to the side it came from: rows marked (from the client) are theirs and must be quoted rather than rewritten.',
      'Name any row still marked open as an item to settle. Add no fact that is not below.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      // Scoped to the client whose brief is on screen. Without a scope there is
      // nothing to draft — a brief spanning every client is not a brief.
      if (!scope) return [];
      // THE GRANT IS THE GATE HERE AS EVERYWHERE ELSE, and `scope_project` is
      // checked separately from the grant's existence: a founder may open their
      // sessions and not their project record, and the client half of this
      // brief is only ever as wide as what they opened.
      const project = await c.env.DB.prepare(
        `SELECT p.id AS id, p.name AS name, p.sector AS sector, p.stage AS stage,
                g.scope_project AS scope_project
           FROM advisor_client_grants g
           JOIN projects p ON p.id = g.project_id
          WHERE g.advisor_user_id = ? AND g.status = 'active' AND p.uid = ?
          ORDER BY g.id DESC LIMIT 1`
      ).bind(userId, scope).first<{
        id: number; name: string; sector: string | null; stage: string | null; scope_project: number;
      }>();
      if (!project) return [];
      const ours = await c.env.DB.prepare(
        `SELECT section, body, open FROM research_brief_notes
          WHERE owner_user_id = ? AND project_id = ? ORDER BY id ASC LIMIT 60`
      ).bind(userId, project.id).all<{ section: string; body: string; open: number }>();
      // The documents the founder pushed — by share, never by namespace, which
      // is the same read the library list unions in. Titles only: what is
      // inside them is Ask's job and needs a citation, not a draft.
      const shared = await c.env.DB.prepare(
        `SELECT d.title AS title, d.kind AS kind
           FROM advisor_client_document_shares s
           JOIN research_documents d ON d.id = s.document_id
          WHERE s.advisor_user_id = ? AND s.status = 'active'
            AND d.owner_user_id IN (
              SELECT id FROM users WHERE founder_id =
                (SELECT founder_id FROM projects WHERE id = ?))
          ORDER BY d.id DESC LIMIT 30`
      ).bind(userId, project.id).all<{ title: string; kind: string }>();
      const theirs = [
        ...(project.scope_project
          ? [`${project.name} (from the client): sector ${project.sector || 'not recorded'}, stage ${project.stage || 'not recorded'}`]
          : []),
        ...(shared.results || []).map((r) => `Document shared by the client: ${r.title} (${r.kind})`),
      ];
      return [
        ...theirs,
        ...(ours.results || []).map((r) => `${r.section} (ours${r.open ? ', open' : ''}): ${r.body}`),
      ];
    },
  },

  'research/market': {
    // The artboard: "on six comparables — a thin base, which the reading states
    // rather than smoothing", and "points to the two stale readings as the ones
    // to re-run". Both halves are instructions, because a model summarising
    // ranges will otherwise average them and drop the sample size.
    instruction: [
      'Summarise what these comparable readings say about the firm’s own service lines.',
      'Carry each range’s comparable count and run date into any statement about it; never average ranges together.',
      'Name the readings that are stale as the ones to re-run before a proposal cites them.',
    ].join(' '),
    gather: async (c, userId) => {
      const rows = await c.env.DB.prepare(
        `SELECT metric, range_low_cents, range_high_cents, comparable_count, ran_at, scope
           FROM research_market_readings WHERE owner_user_id = ? ORDER BY ran_at DESC LIMIT 40`
      ).bind(userId).all<{
        metric: string; range_low_cents: number; range_high_cents: number;
        comparable_count: number; ran_at: string; scope: string | null;
      }>();
      const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
      return (rows.results || []).map((r) =>
        `${r.metric}${r.scope ? ` (${r.scope})` : ''}: ${money(r.range_low_cents)} – ${money(r.range_high_cents)}`
        + `, from ${r.comparable_count} comparable${r.comparable_count === 1 ? '' : 's'}, run ${r.ran_at}`);
    },
  },

  'network/relationships': {
    // The artboard: "who at the firm has the most recorded interactions with
    // that organization — Aoife Brennan sits against Thornbury Capital, where
    // nobody does, which is itself the finding". The last clause is the
    // instruction that matters: the empty answer is an answer.
    instruction: [
      'For each contact below that has no firm owner, say who at the firm has the most recorded interactions with that same organization.',
      'Where nobody at the firm has any interaction with that organization, say so plainly — that is the finding, not a gap to fill.',
      'Suggest nothing about contacts that already have an owner.',
    ].join(' '),
    gather: async (c, userId) => {
      // `bc`, NOT A ONE-LETTER ALIAS. `research_stores_scoping.test.ts` refuses
      // an owner read off a single-letter identifier in this file, because that
      // letter is this codebase's habitual name for a parsed request body and an
      // owner taken from one is how an owner-scoped table stops being one. A SQL
      // alias reads identically to that guard, so the alias gets a longer name
      // rather than the ban being loosened around it.
      const rows = await c.env.DB.prepare(
        `SELECT bc.name, bc.organization, bc.firm_owner_user_id,
                COALESCE(u.name, u.email) AS owner_name,
                (SELECT COUNT(*) FROM partner_book_interactions i WHERE i.contact_id = bc.id) AS n
           FROM partner_book_contacts bc
           LEFT JOIN users u ON u.id = bc.firm_owner_user_id
          WHERE bc.owner_user_id = ? ORDER BY bc.id ASC LIMIT 200`
      ).bind(userId).all<{
        name: string; organization: string | null;
        firm_owner_user_id: number | null; owner_name: string | null; n: number;
      }>();
      const all = rows.results || [];
      // NOTHING TO DRAFT WHEN NOTHING IS ORPHANED, which is the 409 rather than
      // a paragraph congratulating the firm on a full book.
      if (!all.some((r) => !r.firm_owner_user_id)) return [];
      return all.map((r) =>
        `${r.name} at ${r.organization || 'no organization recorded'} — `
        + `${r.firm_owner_user_id ? `owned by ${r.owner_name}` : 'UNASSIGNED'}, ${r.n} recorded interaction${r.n === 1 ? '' : 's'}`);
    },
  },

  'network/introductions': {
    // The artboard: "Every suggestion arrives as a draft ask requiring both
    // consents before it can move — nothing is introduced by the draft itself."
    // Which is a statement about this route: it writes a draft row and nothing
    // else, and the instruction says the same thing to the model so the text it
    // produces does not read as though an introduction had been made.
    instruction: [
      'Suggest possible introductions between the firm’s own contacts, using only the interaction counts below as evidence of who knows whom.',
      'Write each as a draft ask that still needs both sides to consent. Never write as though an introduction has been made.',
      'Where the evidence is one or two interactions, say the path is thin rather than proposing it as strong.',
    ].join(' '),
    gather: async (c, userId) => {
      const rows = await c.env.DB.prepare(
        `SELECT bc.name, bc.organization,
                (SELECT COUNT(*) FROM partner_book_interactions i WHERE i.contact_id = bc.id) AS n
           FROM partner_book_contacts bc
          WHERE bc.owner_user_id = ? ORDER BY bc.id ASC LIMIT 200`
      ).bind(userId).all<{ name: string; organization: string | null; n: number }>();
      // TWO CONTACTS IS THE FLOOR FOR A PATH BETWEEN THEM. One name cannot be
      // introduced to anybody, and a draft over it would be the model filling
      // in the second half.
      const all = (rows.results || []).filter((r) => r.n > 0);
      if (all.length < 2) return [];
      return all.map((r) =>
        `${r.name} at ${r.organization || 'no organization recorded'} — ${r.n} recorded interaction${r.n === 1 ? '' : 's'} with the firm`);
    },
  },

  'offers/catalog': {
    // The artboard: "revenue concentrates in two fixed services while both seat
    // products sold once each. Points to the retainer draft as the gap." Two
    // instructions come out of that — read the concentration, and name the
    // unpriced entries as a SCORING gap rather than a tidying one, because
    // Pipeline scores leads against exactly these rows.
    instruction: [
      'Say where revenue concentrates across this catalog and which entries have sold nothing.',
      'Name any entry with no price as a gap in lead scoring, not as a cosmetic one: an unpriced service scores as a capability and not as a fit.',
      'Use only the figures below. Do not estimate a price for anything that has none.',
    ].join(' '),
    gather: async (c, userId) => {
      const rows = await c.env.DB.prepare(
        `SELECT o.title AS title, o.engagement_model AS model, o.price_cents AS cents,
                o.summary AS summary,
                (SELECT COUNT(*) FROM service_engagements se
                  WHERE se.offering_id = o.id AND se.status <> 'cancelled') AS sold
           FROM service_offerings o WHERE o.owner_user_id = ? ORDER BY o.id ASC LIMIT 100`
      ).bind(userId).all<{
        title: string; model: string | null; cents: number | null; summary: string | null; sold: number;
      }>();
      const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
      return (rows.results || []).map((r) =>
        `${r.title} — ${r.model || 'engagement model not recorded'}; `
        + `${r.cents == null ? 'NO PRICE RECORDED' : money(r.cents)}; sold ${r.sold} time${r.sold === 1 ? '' : 's'}`
        + `${r.summary ? `; includes ${r.summary}` : ''}`);
    },
  },

  'delivery/deliverables': {
    // The artboard: "A chase note per unopened deliverable, naming the item, the
    // date sent, and what the review unblocks … States the milestone consequence
    // without assigning blame."
    //
    // The last clause is the instruction that matters. A model drafting chases
    // will otherwise write something that reads as an accusation, and the one
    // thing this zone knows for certain is that it does NOT know whether the
    // client opened the file: `opened_at` is theirs to set and nothing writes it.
    instruction: [
      'Draft one short chase note per unopened deliverable below: the item, when it went out, and what reviewing it unblocks.',
      'Never say or imply the client ignored it: this product records no opens at all, so an unopened row means we have not heard, not that they did not look.',
      'State the milestone consequence plainly and assign no blame. These are drafts for a person to send.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT d.title AS title, d.version AS version, d.sent_at AS sent_at,
                n.title AS need_title, f.name AS client,
                (SELECT COUNT(*) FROM engagement_milestones m
                  WHERE m.engagement_id = e.id AND m.completed_at IS NULL) AS open_milestones
           FROM engagement_deliverables d
           JOIN engagements e ON e.id = d.engagement_id
           LEFT JOIN founder_needs n ON n.id = e.need_id
           LEFT JOIN users f ON f.id = e.founder_id
          WHERE e.partner_id = ? AND d.sent_at IS NOT NULL AND d.opened_at IS NULL
          ORDER BY d.sent_at ASC LIMIT 100`
      ).bind(me.partner_id).all<{
        title: string; version: string | null; sent_at: string;
        need_title: string | null; client: string | null; open_milestones: number;
      }>();
      return (rows.results || []).map((r) =>
        `${r.client || 'client not recorded'} — "${r.title}"${r.version ? ` v${r.version}` : ''}, `
        + `sent ${String(r.sent_at).slice(0, 10)}, not acknowledged here; `
        + `${r.need_title ? `engagement: ${r.need_title}; ` : ''}`
        + `${r.open_milestones} milestone${r.open_milestones === 1 ? '' : 's'} still open on it`);
    },
  },

  'delivery/board': {
    // The artboard: "Across five live engagements, two carry risk and both are
    // client-facing … Neither is a capacity problem, so neither is solved by
    // adding people."
    //
    // That last clause is the instruction that matters. A model reading a board
    // of at-risk work will otherwise recommend more people for every one of
    // them, which is the wrong answer to a client-side blocker and an expensive
    // one to act on.
    instruction: [
      'Say which engagements below carry risk and why, using only the reasons each row states.',
      'Separate a client-facing problem — an unopened deliverable, a decision the client owes — from a capacity one: the first is not solved by adding people, so never suggest it for one.',
      'An engagement with nothing recorded against it is not healthy, it is unrated: say it has no signal rather than calling it on track.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT n.title AS scope, f.name AS client,
                (SELECT COUNT(*) FROM engagement_seats s
                  WHERE s.engagement_id = e.id AND s.revoked_at IS NULL) AS seats,
                (SELECT COUNT(*) FROM engagement_milestones m
                  WHERE m.engagement_id = e.id AND m.completed_at IS NULL
                    AND m.due_at IS NOT NULL AND m.due_at < date('now')) AS overdue,
                (SELECT COUNT(*) FROM engagement_blockers b
                  WHERE b.engagement_id = e.id AND b.cleared_at IS NULL AND b.side = 'client') AS client_blocked,
                (SELECT COUNT(*) FROM engagement_blockers b
                  WHERE b.engagement_id = e.id AND b.cleared_at IS NULL AND b.side <> 'client') AS our_blocked,
                (SELECT COUNT(*) FROM engagement_deliverables d
                  WHERE d.engagement_id = e.id AND d.sent_at IS NOT NULL AND d.opened_at IS NULL) AS unopened
           FROM engagements e
           LEFT JOIN founder_needs n ON n.id = e.need_id
           LEFT JOIN users f ON f.id = e.founder_id
          WHERE e.partner_id = ? ORDER BY e.created_at DESC LIMIT 100`
      ).bind(me.partner_id).all<{
        scope: string | null; client: string | null; seats: number;
        overdue: number; client_blocked: number; our_blocked: number; unopened: number;
      }>();
      return (rows.results || []).map((r) => {
        const signals = [
          r.overdue ? `${r.overdue} milestone(s) past due` : '',
          r.client_blocked ? `${r.client_blocked} open blocker(s) on the client's side` : '',
          r.our_blocked ? `${r.our_blocked} open blocker(s) on ours` : '',
          r.unopened ? `${r.unopened} deliverable(s) sent and not opened` : '',
        ].filter(Boolean);
        return `${r.client || 'client not recorded'} — ${r.scope || 'scope not recorded'}; `
          + `${r.seats ? 'embedded seat' : 'project'}; `
          + `${signals.length ? signals.join('; ') : 'NOTHING RECORDED — unrated, not healthy'}`;
      });
    },
  },

  'pipeline/retainers': {
    // The artboard: "Thornfield renews in 17 days at 34% utilization. The draft
    // opens with what they have NOT USED rather than what they owe — a
    // right-sizing conversation at $5,000/mo keeps the relationship, where a
    // renewal notice at the current figure invites them to do the arithmetic
    // themselves and leave."
    //
    // The instruction that matters is the opening move: a model handed a
    // renewal will write a renewal notice, which is the one thing this page
    // exists to argue against. The second is that a retainer with no retained
    // hours has no utilisation — a fee-based deal is a different shape, not a
    // badly consumed one, and reading it as a churn risk would be a finding
    // about a number that does not exist.
    instruction: [
      'Draft one right-sizing conversation for the retainer below that renews soonest at the lowest utilisation.',
      'Open with what the client has NOT used, never with what they owe: a renewal notice at the current figure invites them to do the arithmetic themselves.',
      'Where a retainer has no retained hours, it has no utilisation at all — say so and do not read it as under-consumption.',
      'Use only the figures given. Never propose a new monthly amount the record cannot support, and never state a renewal date that is not recorded.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT f.name AS client, n.title AS need_title,
                r.shape, r.cadence, r.amount_cents, r.retained_hours, r.renews_at, r.ended_at,
                (SELECT u.hours_used FROM retainer_usage u
                  WHERE u.retainer_id = r.id ORDER BY u.period DESC LIMIT 1) AS hours_used
           FROM partner_retainers r
           JOIN engagements e ON e.id = r.engagement_id
           LEFT JOIN founder_needs n ON n.id = e.need_id
           LEFT JOIN users f ON f.id = e.founder_id
          WHERE e.partner_id = ? AND r.ended_at IS NULL
          ORDER BY r.renews_at IS NULL, r.renews_at LIMIT 50`
      ).bind(me.partner_id).all<{
        client: string | null; need_title: string | null; shape: string; cadence: string;
        amount_cents: number | null; retained_hours: number | null;
        renews_at: string | null; ended_at: string | null; hours_used: number | null;
      }>();
      return (rows.results || []).map((r) => {
        const util = r.retained_hours
          ? `${Math.round(((r.hours_used || 0) / Number(r.retained_hours)) * 100)}% of ${r.retained_hours} retained hours`
          : 'NO RETAINED HOURS — this is not sold by the hour and has no utilisation';
        return `${r.client || 'client not recorded'} — ${r.need_title || 'scope not recorded'}; `
          + `${r.shape === 'embedded_seat' ? 'embedded seat' : 'retainer'}, ${r.cadence}; `
          + `${r.amount_cents == null ? 'NO AMOUNT RECORDED' : `$${Math.round(Number(r.amount_cents) / 100).toLocaleString('en-US')}`}; `
          + `${util}; `
          + `renews ${r.renews_at ? String(r.renews_at).slice(0, 10) : 'NO DATE RECORDED'}`;
      });
    },
  },

  'pipeline/negotiations': {
    // The artboard: "Aperture has asked for a flexible scope at a fixed price
    // twice, and has sat in Scoping for nine days. The counter reframes it as a
    // retainer at the same monthly figure — which gives them the flexibility
    // they actually want and gives you the utilization data to price the next
    // quarter. It also names, in one line, why fixed-price and flexible cannot
    // coexist."
    //
    // The instruction that matters is that a counter must be built from the
    // CLAUSES ALREADY ON THE TABLE. A model handed a stalled deal will
    // otherwise invent a concession nobody offered — and a counter naming a
    // term the firm never put in writing is worse than no counter at all,
    // because a person may send it.
    instruction: [
      'Draft one counter for the negotiation that has been still longest, built only from the clauses listed below: what each side asked, what has already been conceded or refused, and where a term is still open.',
      'Never invent a term, a price or a concession. If the record does not carry a position for a clause, say the position is not recorded rather than supplying one.',
      'Name in one line why the two positions cannot both hold — that sentence is the counter’s whole job.',
      'A stalled day count is time since a RECORDED move, not since the client last spoke. Never write as though silence has been measured.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT f.name AS client, n.title AS need_title, q.price,
                g.stage, g.ball, g.open_question, g.last_moved_at,
                (SELECT GROUP_CONCAT(
                    t.label || ': we asked ' || COALESCE(t.our_position, 'NOT RECORDED')
                    || '; they asked ' || COALESCE(t.their_position, 'NOT RECORDED')
                    || '; lands ' || COALESCE(t.landing, 'NOT AGREED')
                    || ' [' || t.state || ']', ' | ')
                   FROM quote_terms t WHERE t.negotiation_id = g.id) AS terms
           FROM quote_negotiations g
           JOIN quotes q ON q.id = g.quote_id
           LEFT JOIN founder_needs n ON n.id = q.need_id
           LEFT JOIN users f ON f.id = n.founder_id
          WHERE q.partner_id = ? AND g.stage <> 'closed'
          ORDER BY g.last_moved_at ASC LIMIT 25`
      ).bind(me.partner_id).all<{
        client: string | null; need_title: string | null; price: number | null;
        stage: string; ball: string; open_question: string | null;
        last_moved_at: string; terms: string | null;
      }>();
      return (rows.results || []).map((r) =>
        `${r.client || 'client not recorded'} — ${r.need_title || 'scope not recorded'}; `
        + `$${Number(r.price || 0).toLocaleString('en-US')}; stage ${r.stage}; `
        + `${r.ball === 'us' ? 'our move' : 'their move'}; `
        + `last RECORDED move ${String(r.last_moved_at).slice(0, 10)}; `
        + `open question: ${r.open_question || 'NONE NAMED — nobody has said what is blocking it'}; `
        + `terms: ${r.terms || 'NONE RECORDED'}`);
    },
  },

  'pipeline/proposals': {
    // The artboard's own reading of this book: "Aperture has been sent for nine
    // days with no read receipt at all, which is a different problem from Kelp
    // Bio opening theirs four times and going quiet. The first is a delivery
    // failure; the second is a decision in progress."
    //
    // THIS BUILD CANNOT MAKE THAT DISTINCTION and the instruction has to say
    // so, or a model handed a list of silent proposals will confidently sort
    // them into the two buckets the artboard names. Nothing records an open.
    // The second instruction is the taxonomy: a loss with no reason recorded is
    // the finding, not a gap to fill by guessing which reason it probably was.
    instruction: [
      'Read the decided proposals below for what they have in common: which loss reasons recur, which shapes close, and at what values.',
      'Nothing in this product records whether a client opened a proposal. Never say or imply that one was read, ignored or never opened — a silent proposal is silent, and that is all the record says.',
      'A loss with no reason recorded is a gap in the firm’s own record and the most useful thing you can point at. Never guess which reason it was.',
      'Use only the reasons as given. Do not invent a category, and do not read a pattern out of fewer than three decided proposals — say the sample is too small instead.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT q.price, q.status, q.loss_reason, q.decided_at, q.timeline_weeks,
                n.title AS need_title, f.name AS client,
                r.shape AS retainer_shape,
                (SELECT COUNT(*) FROM quote_versions v WHERE v.quote_id = q.id) AS versions
           FROM quotes q
           LEFT JOIN founder_needs n ON n.id = q.need_id
           LEFT JOIN users f ON f.id = n.founder_id
           LEFT JOIN engagements e ON e.quote_id = q.id
           LEFT JOIN partner_retainers r ON r.engagement_id = e.id
          WHERE q.partner_id = ?
          ORDER BY q.created_at DESC LIMIT 100`
      ).bind(me.partner_id).all<{
        price: number | null; status: string; loss_reason: string | null;
        decided_at: string | null; timeline_weeks: number | null;
        need_title: string | null; client: string | null;
        retainer_shape: string | null; versions: number;
      }>();
      return (rows.results || []).map((r) => {
        const state = r.status === 'accepted' ? 'WON'
          : (r.status === 'rejected' ? 'LOST' : (r.status === 'withdrawn' ? 'WITHDRAWN' : 'SENT, not decided'));
        return `${r.client || 'client not recorded'} — ${r.need_title || 'scope not recorded'}; `
          + `${r.retainer_shape === 'retainer' ? 'retainer' : (r.retainer_shape === 'embedded_seat' ? 'embedded seat' : 'fixed scope')}; `
          + `$${Number(r.price || 0).toLocaleString('en-US')}`
          + `${r.timeline_weeks ? ` over ${r.timeline_weeks} weeks` : ''}; `
          + `${state}`
          + `${state === 'LOST' ? `; reason: ${r.loss_reason || 'NONE RECORDED — nobody entered one'}` : ''}; `
          + `${r.versions} revision(s) recorded`;
      });
    },
  },

  'pipeline/analytics': {
    // The artboard: "You lost 4 of 9 decided bids this quarter and two of those
    // losses were on price, every one of them fixed-scope, all against smaller
    // shops. Retainers lost one, and not on price. The forecast of $58,000
    // assumes the current 56% rate holds across $104,000 still live — reshape
    // the open fixed-scope bids into retainers and that number moves without
    // discounting anything."
    //
    // THE FAILURE MODE HERE IS NOT INVENTION, IT IS CONFIDENCE. Every figure is
    // already computed and handed over, so a model has nothing to make up — what
    // it will do by default is read a pattern out of three decisions and phrase
    // it as a finding. The instructions are therefore about how many rows a
    // claim is allowed to rest on, and about the difference between a loss with
    // a recorded reason and a loss nobody explained.
    instruction: [
      'Narrate the quarter from the figures below and nothing else: win rate, median cycle, the shape breakdown, the loss reasons and the weighted forecast.',
      'Say how many decisions each claim rests on, and where a shape has fewer than three decided bids, say the sample is too small to read rather than stating a pattern.',
      'A loss with no recorded reason is not a loss on price. Never fold the unexplained losses into the taxonomy, and where they outnumber the explained ones, say the pattern describes only the explained ones.',
      'The forecast is the open pipeline weighted by the current rate — it is an assumption, not a prediction. Say so, and never propose a discount as the way to move it.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      // One row per decided bid, with the shape it was filed under and the
      // reason it was lost. The narrator is given the RECORD, not the summary,
      // so it cannot be handed a rounded figure and asked to explain it.
      const rows = await c.env.DB.prepare(
        `SELECT q.status, q.price, q.loss_reason, q.created_at, q.decided_at,
                n.category AS shape, f.name AS client
           FROM quotes q
           LEFT JOIN founder_needs n ON n.id = q.need_id
           LEFT JOIN users f ON f.id = n.founder_id
          WHERE q.partner_id = ? AND q.status IN ('accepted', 'rejected', 'submitted')
          ORDER BY q.decided_at IS NULL, q.decided_at DESC
          LIMIT 200`
      ).bind(me.partner_id).all<{
        status: string; price: number | null; loss_reason: string | null;
        created_at: string | null; decided_at: string | null;
        shape: string | null; client: string | null;
      }>();
      return (rows.results || []).map((r) => {
        const value = r.price == null
          ? 'NO VALUE RECORDED'
          : `$${Math.round(Number(r.price)).toLocaleString('en-US')}`;
        const outcome = r.status === 'accepted'
          ? 'WON'
          : (r.status === 'rejected'
            ? `LOST — ${r.loss_reason ? `reason recorded: ${r.loss_reason}` : 'NO REASON RECORDED, do not read this as a price loss'}`
            : 'STILL OPEN, in no quarter and in no win rate');
        return `${r.client || 'client not recorded'}; shape ${r.shape || 'NOT RECORDED'}; ${value}; `
          + `${outcome}; decided ${r.decided_at ? String(r.decided_at).slice(0, 10) : 'not yet'}`;
      });
    },
  },

  'pipeline/leads': {
    // The artboard: "Accepting <lead> drafts a proposal shaped as a retainer
    // rather than a project — because retainers are where you win, and their
    // eight-week framing is a project only by habit. Their stated budget covers
    // three months at your rate."
    //
    // Two instructions carry it. The shape claim must come from the firm's OWN
    // record — a model that recommends a retainer because retainers are
    // fashionable is worse than one that recommends nothing — and the budget
    // arithmetic must use the firm's stated floor rather than a guess at its
    // rate. Where either is missing, the draft says so instead of inventing it,
    // which is the same refusal the score itself makes.
    instruction: [
      'Draft a proposal outline for the strongest open lead below, using only the firm’s own listed services, stated budget floor and the client’s own words.',
      'Recommend a shape — retainer or fixed project — only when this firm’s own won work supports it, and name the evidence. Where the record does not say which shape wins, say that and recommend neither.',
      'Check the client’s stated budget against the firm’s stated floor and say plainly whether it clears it. Where either number is absent, say which is missing rather than estimating it.',
      'Never invent a capability, a rate or a timeline. A lead the firm’s rules exclude is not a lead to draft for — say so and stop.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      // The open leads, plus the two things a shape recommendation needs: what
      // this firm sells and what it says it will not take.
      const [leads, offerings, rules] = await Promise.all([
        c.env.DB.prepare(
          `SELECT n.title, n.description, n.category, n.budget_min, n.budget_max, n.timeline,
                  f.name AS client
             FROM founder_needs n
             LEFT JOIN users f ON f.id = n.founder_id
            WHERE n.status = 'open'
              AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.need_id = n.id AND q.partner_id = ?)
              AND NOT EXISTS (SELECT 1 FROM partner_lead_passes lp WHERE lp.need_id = n.id AND lp.partner_id = ?)
            ORDER BY n.created_at DESC LIMIT 25`
        ).bind(me.partner_id, me.partner_id).all<any>(),
        c.env.DB.prepare(
          `SELECT o.title, o.category,
                  (SELECT COUNT(*) FROM engagements e
                     JOIN quotes q ON q.id = e.quote_id
                    WHERE e.partner_id = o.partner_id) AS firm_wins
             FROM service_offerings o
            WHERE o.partner_id = ? AND o.is_active = 1 LIMIT 25`
        ).bind(me.partner_id).all<any>(),
        c.env.DB.prepare(
          `SELECT kind, value, floor_cents, statement FROM partner_fit_rules
            WHERE partner_id = ? AND is_active = 1 LIMIT 50`
        ).bind(me.partner_id).all<any>(),
      ]);

      const floor = (rules.results || []).find((r: any) => r.kind === 'budget_floor' && r.floor_cents != null);
      const context = [
        `FIRM SELLS: ${(offerings.results || []).map((o: any) => o.title).join('; ') || 'NOTHING LISTED — no capability on record'}`,
        `FIRM BUDGET FLOOR: ${floor ? `$${Math.round(Number(floor.floor_cents) / 100).toLocaleString('en-US')}` : 'NOT STATED — do not estimate one'}`,
        `FIRM EXCLUSIONS: ${(rules.results || []).filter((r: any) => r.kind !== 'budget_floor' && r.kind !== 'best_fit').map((r: any) => r.value).join('; ') || 'none stated'}`,
      ];
      return context.concat((leads.results || []).map((l: any) =>
        `LEAD — ${l.client || 'client not recorded'}: ${l.title}; `
        + `${l.description || 'no description given'}; `
        + `budget ${l.budget_max == null ? 'NOT STATED by the client' : `up to $${Number(l.budget_max).toLocaleString('en-US')}`}; `
        + `timeline ${l.timeline || 'not stated'}`));
    },
  },

  'delivery/health': {
    // The artboard: "Per engagement: drift against SOW, utilization against the
    // retainer record, and where satisfaction is ABSENT rather than low …
    // Thornfield reads as the near-term risk on utilization and a decision the
    // client has not made; Verwood reads as drift plus silence, which is a
    // scoping conversation and not a renewal one yet."
    //
    // "Absent rather than low" is the instruction that matters, and it is the
    // one a model gets wrong by default: a missing score reads as a bad one,
    // an unassessed scope reads as a clean one, and an engagement with nothing
    // recorded reads as healthy. Each of those turns silence into a finding
    // pointing the wrong way.
    instruction: [
      'Read renewal risk per engagement below, using only what each row states.',
      'Absent is not low and absent is not fine: no satisfaction score means nobody asked, an unassessed scope means nobody looked, and an engagement with nothing recorded is unrated rather than healthy. Say which, never fill it in.',
      'Utilisation is read from the retainer record on Pipeline · Retainers. Quote it; never recompute it or reason from a different one.',
      'Separate a scoping conversation from a renewal one: drift plus silence is the first, low utilisation against a near renewal date is the second, and they are not solved the same way.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT f.name AS client, n.title AS scope, r.renews_at AS renews_at,
                h.scope_state AS scope_state, h.scope_note AS scope_note,
                h.satisfaction AS satisfaction, h.satisfaction_source AS satisfaction_source,
                o.name AS owner_name,
                (SELECT COUNT(*) FROM engagement_milestones m
                  WHERE m.engagement_id = e.id AND m.completed_at IS NULL
                    AND m.due_at IS NOT NULL AND m.due_at < date('now')) AS overdue,
                (SELECT COUNT(*) FROM engagement_blockers b
                  WHERE b.engagement_id = e.id AND b.cleared_at IS NULL AND b.side = 'client') AS client_blocked,
                (SELECT COUNT(*) FROM engagement_deliverables d
                  WHERE d.engagement_id = e.id AND d.sent_at IS NOT NULL AND d.opened_at IS NULL) AS unopened
           FROM engagements e
           LEFT JOIN founder_needs n ON n.id = e.need_id
           LEFT JOIN users f ON f.id = e.founder_id
           LEFT JOIN partner_retainers r ON r.engagement_id = e.id
           LEFT JOIN partner_engagement_health h ON h.engagement_id = e.id
           LEFT JOIN users o ON o.id = h.owner_user_id
          WHERE e.partner_id = ? AND e.cancelled_at IS NULL
          ORDER BY e.created_at DESC LIMIT 100`
      ).bind(me.partner_id).all<{
        client: string | null; scope: string | null; renews_at: string | null;
        scope_state: string | null; scope_note: string | null;
        satisfaction: number | null; satisfaction_source: string | null;
        owner_name: string | null; overdue: number; client_blocked: number; unopened: number;
      }>();
      return (rows.results || []).map((r) => {
        const signals = [
          r.overdue ? `${r.overdue} milestone(s) past due` : '',
          r.client_blocked ? `${r.client_blocked} open blocker(s) on the client's side` : '',
          r.unopened ? `${r.unopened} deliverable(s) sent and not acknowledged here` : '',
        ].filter(Boolean);
        return `${r.client || 'client not recorded'} — ${r.scope || 'scope not recorded'}; `
          + `owner: ${r.owner_name || 'UNASSIGNED'}; `
          + `renews: ${r.renews_at ? String(r.renews_at).slice(0, 10) : 'no renewal date recorded'}; `
          + `scope: ${r.scope_state ? `${r.scope_state}${r.scope_note ? ` (${r.scope_note})` : ''}` : 'NOT ASSESSED — nobody has looked'}; `
          + `satisfaction: ${r.satisfaction == null ? 'NO SCORE HEARD — absent, not low' : `${r.satisfaction}/5 (${r.satisfaction_source})`}; `
          + `${signals.length ? signals.join('; ') : 'NOTHING RECORDED — unrated, not healthy'}`;
      });
    },
  },

  'delivery/status-reports': {
    // The artboard: "One report per client drafted from the week's real
    // activity — shipped items from the deliverables log, next steps from
    // milestones, blockers from where the work actually stopped … every draft
    // waits for a person to send."
    //
    // The instruction that matters is the copy decision the zone is built
    // around, and it cuts both ways: a client-side blocker must be NAMED, and
    // must not be LEANED ON. A model told only the first writes an accusation;
    // one told only the second writes a report that hides why the work stopped
    // and makes the delay look like the firm's. The artboard's own instNote is
    // the target — "not our delay, still our problem".
    instruction: [
      'Draft one short status report per engagement below: what shipped, what is next, and what it is blocked on.',
      'Use only the rows given. Never write a shipped item, a milestone or a blocker that is not listed, and where a section has nothing, say so plainly rather than filling it.',
      'Where a blocker is on the client’s side, name it plainly and say the deadline does not move because of it — not our delay, still our problem. Never phrase it as an accusation and never use it as an excuse.',
      'A deliverable sent and not acknowledged means we have not heard, never that the client ignored it.',
      'These are drafts. Never write as though the report has been sent.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      // One line per LIVE ENGAGEMENT, not per existing report: the batch drafts
      // the reports that are owed, and an engagement with none written yet is
      // exactly the one that needs drafting.
      const rows = await c.env.DB.prepare(
        `SELECT e.id AS engagement_id, f.name AS client, n.title AS scope,
                (SELECT GROUP_CONCAT(d.title, '; ') FROM engagement_deliverables d
                  WHERE d.engagement_id = e.id AND d.sent_at IS NOT NULL
                    AND d.sent_at >= date('now', '-30 days')) AS shipped,
                (SELECT COUNT(*) FROM engagement_deliverables d
                  WHERE d.engagement_id = e.id AND d.sent_at IS NOT NULL AND d.opened_at IS NULL) AS unopened,
                (SELECT GROUP_CONCAT(m.title, '; ') FROM engagement_milestones m
                  WHERE m.engagement_id = e.id AND m.completed_at IS NULL) AS next_up,
                (SELECT GROUP_CONCAT(b.summary, '; ') FROM engagement_blockers b
                  WHERE b.engagement_id = e.id AND b.cleared_at IS NULL AND b.side = 'client') AS client_blocked,
                (SELECT GROUP_CONCAT(b.summary, '; ') FROM engagement_blockers b
                  WHERE b.engagement_id = e.id AND b.cleared_at IS NULL AND b.side <> 'client') AS our_blocked
           FROM engagements e
           LEFT JOIN founder_needs n ON n.id = e.need_id
           LEFT JOIN users f ON f.id = e.founder_id
          WHERE e.partner_id = ? AND e.cancelled_at IS NULL
          ORDER BY e.created_at DESC LIMIT 50`
      ).bind(me.partner_id).all<{
        engagement_id: number; client: string | null; scope: string | null;
        shipped: string | null; unopened: number; next_up: string | null;
        client_blocked: string | null; our_blocked: string | null;
      }>();
      return (rows.results || []).map((r) =>
        `${r.client || 'client not recorded'} — ${r.scope || 'scope not recorded'}; `
        + `shipped in the last 30 days: ${r.shipped || 'NOTHING RECORDED'}; `
        + `next: ${r.next_up || 'no open milestone recorded'}; `
        + `blocked on the client's side: ${r.client_blocked || 'nothing'}; `
        + `blocked on ours: ${r.our_blocked || 'nothing'}; `
        + `${r.unopened} deliverable(s) sent and not acknowledged here`);
    },
  },

  'delivery/capacity': {
    // The artboard: "Findings across N people: who is over cap, by how much, and
    // which overage sits behind a granted seat. Separates schedulable overflow
    // from seat commitments, since only one of them can be moved without going
    // back to the founder."
    //
    // Two instructions carry the weight. The first is that a person nobody
    // logged hours for is UNMEASURED, not idle — a model reading a sparse book
    // will otherwise report a firm with capacity to spare. The second is the
    // zone's whole argument: an overage behind a granted seat is not fixed by
    // moving project work, because the seat is what the founder granted and
    // only they can change it.
    instruction: [
      'Say which people below are over the cap their own row states, and by how much, using only the hours each row carries.',
      'Never infer a cap: a person whose row states none is not over anything, and a person with no hours logged is unmeasured rather than idle or free.',
      'Where a total is marked a floor because internal hours were not stated, treat it as a lower bound and say so rather than reporting it as the week.',
      'Separate schedulable overflow from a granted seat: an overage behind a seat inside a client’s systems is a trust exposure and is renegotiated with the founder, never solved by reallocating project work.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      // The same three-table read the zone does, flattened per person: client
      // hours, the seats that person holds, their internal statement and the
      // cap that applies to them — their own if they have one, else the firm's.
      const rows = await c.env.DB.prepare(
        `SELECT u.id AS user_id, u.name AS name,
                (SELECT COALESCE(SUM(h.hours), 0) FROM engagement_hours h
                   JOIN engagements e ON e.id = h.engagement_id
                  WHERE h.person_user_id = u.id AND e.partner_id = u.partner_id
                    AND h.period = strftime('%Y-%m', 'now')) AS client_hours,
                (SELECT COUNT(*) FROM engagement_hours h
                   JOIN engagements e ON e.id = h.engagement_id
                  WHERE h.person_user_id = u.id AND e.partner_id = u.partner_id
                    AND h.period = strftime('%Y-%m', 'now')) AS hour_rows,
                (SELECT i.hours FROM partner_internal_hours i
                  WHERE i.partner_id = u.partner_id AND i.person_user_id = u.id
                    AND i.period = strftime('%Y-%m', 'now')) AS internal_hours,
                (SELECT COUNT(*) FROM engagement_seats s
                   JOIN engagements e ON e.id = s.engagement_id
                  WHERE s.holder_user_id = u.id AND e.partner_id = u.partner_id
                    AND s.revoked_at IS NULL) AS live_seats,
                (SELECT GROUP_CONCAT(s.scope, '; ') FROM engagement_seats s
                   JOIN engagements e ON e.id = s.engagement_id
                  WHERE s.holder_user_id = u.id AND e.partner_id = u.partner_id
                    AND s.revoked_at IS NULL) AS seat_scopes,
                COALESCE(
                  (SELECT p.weekly_hours FROM partner_capacity p
                    WHERE p.partner_id = u.partner_id AND p.person_user_id = u.id),
                  (SELECT p.weekly_hours FROM partner_capacity p
                    WHERE p.partner_id = u.partner_id AND p.person_user_id IS NULL)
                ) AS cap_hours
           FROM users u
          WHERE u.partner_id = ? ORDER BY u.id LIMIT 100`
      ).bind(me.partner_id).all<{
        user_id: number; name: string | null; client_hours: number; hour_rows: number;
        internal_hours: number | null; live_seats: number; seat_scopes: string | null;
        cap_hours: number | null;
      }>();
      return (rows.results || []).map((r) => {
        // UNMEASURED IS ITS OWN STATE, and it is not zero. A row with no hours
        // and no internal statement says so before it says anything else.
        if (!r.hour_rows && r.internal_hours == null) {
          return `${r.name || 'name not recorded'} — NO HOURS RECORDED this period; unmeasured, not idle; `
            + `${r.live_seats} live seat(s)${r.seat_scopes ? ` (${r.seat_scopes})` : ''}`;
        }
        const total = Number(r.client_hours || 0) + Number(r.internal_hours ?? 0);
        return `${r.name || 'name not recorded'} — ${total} h`
          + `${r.internal_hours == null ? ' (A FLOOR: internal hours not stated)' : ''}`
          + `; ${r.cap_hours == null ? 'NO CAP STATED for them' : `cap ${r.cap_hours} h`}`
          + `; ${r.client_hours} h on client work`
          + `; ${r.live_seats} live seat(s)${r.seat_scopes ? ` (${r.seat_scopes})` : ''}`;
      });
    },
  },

  'offers/audience-fit': {
    // The artboard: "For each stated exclusion, a short pass note a person can
    // send: the reason, and where relevant a named firm better suited. Points to
    // the floor as the most-used exclusion, and to the absent capabilities as
    // the two worth revisiting if demand keeps arriving for them."
    //
    // The instruction below refuses the one thing a model will otherwise do
    // here: soften a pass into a maybe. A pass with a reason is the zone's
    // entire argument, and a note that leaves the door ajar is the silence it
    // exists to replace wearing better manners.
    instruction: [
      'Draft one short pass note per stated exclusion below, in the firm’s own words, quoting the sentence it already wrote.',
      'Where an exclusion names a firm to refer to, include it. Where it names none, do not invent one.',
      'A pass is a no with a reason: never soften it into a maybe, and never promise a revisit the rules do not state.',
      'An exclusion with no sentence recorded cannot be drafted from — say so rather than writing one for it.',
    ].join(' '),
    gather: async (c, userId) => {
      // `partner_fit_rules` keys on `partners.id`, so the caller's partner row
      // is resolved first and an account with none has nothing to read.
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT r.kind AS kind, r.value AS value, r.floor_cents AS floor_cents,
                r.statement AS statement, r.referred_to AS referred_to
           FROM partner_fit_rules r
          WHERE r.partner_id = ? AND r.is_active = 1 AND r.kind <> 'best_fit'
          ORDER BY r.kind, r.id LIMIT 100`
      ).bind(me.partner_id).all<{
        kind: string; value: string | null; floor_cents: number | null;
        statement: string | null; referred_to: string | null;
      }>();
      return (rows.results || []).map((r) => {
        const subject = r.kind === 'budget_floor'
          ? (r.floor_cents == null ? 'a floor with no amount recorded' : `under $${Math.round(r.floor_cents / 100).toLocaleString('en-US')}`)
          : (r.value || 'unnamed');
        return `${r.kind.replace('_', ' ')} — ${subject}; `
          + `${r.statement ? `the firm's words: "${r.statement}"` : 'NO SENTENCE RECORDED'}`
          + `${r.referred_to ? `; refer to ${r.referred_to}` : '; no alternative named'}`;
      });
    },
  },

  'offers/proof': {
    // The artboard: "A consent request per held outcome, naming the engagement,
    // the specific claim, and where it would appear — sent by a person from the
    // account that did the work. The draft for Verwood notes the unopened
    // deliverable, so the ask does not arrive before the review does."
    //
    // The last clause is the instruction that matters. A model drafting consent
    // requests will otherwise write one for every held item at the same
    // urgency, and the artboard's whole point is that some outcomes are not
    // ready to be asked about yet.
    instruction: [
      'Draft one consent request per held outcome below, naming the specific claim it would publish.',
      'Where the outcome came from no engagement, say the request has nothing on the client’s side to refer to, and do not invent one.',
      'These are drafts for a person to send: never write as though a request has been sent or a consent obtained.',
    ].join(' '),
    gather: async (c, userId) => {
      // `partner_proof_items` keys on `partners.id`, so the caller's partner
      // row is resolved first and an account with none has nothing to read.
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT p.title AS title, p.outcome_note AS outcome, n.title AS need_title,
                (SELECT COUNT(*) FROM partner_proof_consents k
                  WHERE k.proof_item_id = p.id AND k.consent_given = 1 AND k.withdrawn_at IS NULL) AS live,
                (SELECT COUNT(*) FROM partner_proof_consents k
                  WHERE k.proof_item_id = p.id AND k.consent_given = 0 AND k.withdrawn_at IS NULL) AS pending,
                (SELECT COUNT(*) FROM partner_proof_consents k
                  WHERE k.proof_item_id = p.id AND k.withdrawn_at IS NOT NULL) AS withdrawn
           FROM partner_proof_items p
           LEFT JOIN engagements e ON e.id = p.engagement_id
           LEFT JOIN founder_needs n ON n.id = e.need_id
          WHERE p.partner_id = ? ORDER BY p.created_at DESC LIMIT 100`
      ).bind(me.partner_id).all<{
        title: string; outcome: string | null; need_title: string | null;
        live: number; pending: number; withdrawn: number;
      }>();
      return (rows.results || []).filter((r) => !r.live).map((r) =>
        `${r.title} — ${r.need_title ? `from the engagement "${r.need_title}"` : 'NOT FROM ANY ENGAGEMENT'}; `
        + `${r.outcome ? `claims: ${r.outcome}` : 'no result claimed'}; `
        + `${r.withdrawn ? 'a consent was withdrawn' : r.pending ? 'asked, no answer yet' : 'nobody has been asked'}`);
    },
  },

  'offers/perk-deals': {
    // The artboard: "For each expiring perk, what its expiry revokes and from
    // whom … Points to which redeemers lose access, so a notice can go out
    // before it happens rather than after." The last clause is what the draft
    // is FOR — it is a warning list, not a summary — and the instruction says so
    // rather than leaving the model to produce a tidy recap of the whole book.
    instruction: [
      'For each perk below that is expiring, say what its expiry revokes and how many redeemers lose it.',
      'A perk recorded as granting nothing beyond the offer revokes nothing on expiry: say so rather than listing it as a loss.',
      'Nothing in this product withdraws a scope automatically, so write this as a notice somebody must send, never as something already done.',
    ].join(' '),
    gather: async (c, userId) => {
      const today = todayIso();
      const rows = await c.env.DB.prepare(
        `SELECT p.offer AS offer, p.ends_at AS ends_at, p.grant_scope AS grant_scope,
                p.claim_cap AS cap,
                (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id) AS redeemed
           FROM perks p
          WHERE p.partner_user_id = ? AND p.ends_at IS NOT NULL
          ORDER BY p.ends_at ASC LIMIT 100`
      ).bind(userId).all<{
        offer: string; ends_at: string; grant_scope: string | null; cap: number | null; redeemed: number;
      }>();
      return (rows.results || []).map((p) =>
        `${p.offer} — ${perkLifecycle(p.ends_at, today)}, ends ${p.ends_at}; `
        + `${p.redeemed} redeemed${p.cap == null ? ' (uncapped)' : ` of ${p.cap}`}; `
        + `${p.grant_scope ? `grants ${p.grant_scope}` : 'grants nothing beyond the offer itself'}`);
    },
  },

  'offers/visibility': {
    // The artboard: "Points to the referral and webinar surfaces as the ones
    // converting, and to the directory as volume without intent … Where a
    // surface has no view counter the read says so instead of modelling one."
    // The last clause is the instruction that matters most here, because this
    // product has no view counter on ANY surface and a model asked to compare
    // reach will otherwise supply one.
    instruction: [
      'Compare these surfaces by the engagements each produced, and say which are converting.',
      'There is no view count and no lead count for any of them: say so rather than estimating either, and never rank by reach.',
      'A surface with no engagement is volume without intent, and is a placement to change rather than a channel to celebrate.',
    ].join(' '),
    gather: async (c, userId) => {
      // `partner_surfaces` keys on `partners.id`, not on the account — the
      // convention migration 209's header spells out — so the caller's partner
      // row is resolved first and an account with none has nothing to read.
      const me = await c.env.DB.prepare('SELECT partner_id FROM users WHERE id = ?')
        .bind(userId).first<{ partner_id: number | null }>();
      if (!me?.partner_id) return [];
      const rows = await c.env.DB.prepare(
        `SELECT s.name AS name, s.kind AS kind, s.is_active AS is_active,
                (SELECT COUNT(*) FROM engagement_sources es WHERE es.surface_id = s.id) AS engagements
           FROM partner_surfaces s WHERE s.partner_id = ? ORDER BY engagements DESC LIMIT 100`
      ).bind(me.partner_id).all<{ name: string; kind: string; is_active: number; engagements: number }>();
      return (rows.results || []).map((r) =>
        `${r.name} (${r.kind}${r.is_active ? '' : ', retired'}) — `
        + `${r.engagements} engagement${r.engagements === 1 ? '' : 's'} sourced; no view count and no lead count recorded`);
    },
  },

  'network/organizations': {
    // The artboard: "Points to every client resting on one known contact … Names
    // the exposure; the second contact is a person's job to make." The last
    // clause is the instruction that matters — a model asked about thin coverage
    // will otherwise volunteer who to call, and it does not know anyone.
    instruction: [
      'Name every company below that the firm knows through exactly one person, and what that relationship is to the firm.',
      'State the exposure and stop there: do not suggest who to contact, and do not estimate anything the rows do not state.',
      'Where a company has more than one contact, say so rather than listing it as exposed.',
    ].join(' '),
    gather: async (c, userId) => {
      const rows = await c.env.DB.prepare(
        `SELECT bc.organization AS org, bc.relationship AS rel, COUNT(*) AS people
           FROM partner_book_contacts bc
          WHERE bc.owner_user_id = ? AND bc.organization IS NOT NULL AND TRIM(bc.organization) <> ''
          GROUP BY LOWER(TRIM(bc.organization))
          ORDER BY people ASC LIMIT 200`
      ).bind(userId).all<{ org: string; rel: string | null; people: number }>();
      return (rows.results || []).map((r) =>
        `${r.org} — ${r.rel ? `recorded as a ${r.rel.replace('_', ' ')}` : 'relationship not recorded'}, `
        + `${r.people} contact${r.people === 1 ? '' : 's'} known`);
    },
  },

  // ── INVESTOR SURFACES ───────────────────────────────────────────────────
  //
  // Scoped by ROLE rather than by a firm column: `deals` carries no investor
  // id, and the deal list an investor reads is the firm-wide funnel by design
  // — browsing open deals is the marketplace half of this product. So the
  // gather below refuses a caller who is not privileged and reads the same
  // rows `GET /api/deals` would have returned them, rather than inventing a
  // narrower scope that the page they are looking at does not have.

  'deals/pipeline': {
    // ID1's band: "One note per stale deal: last recorded activity, what is
    // blocking, and the honest option — assign an owner or pass and record the
    // reason."
    //
    // The instruction that matters is the last clause. A model handed a stale
    // deal will write a chase note; the artboard's whole argument is that the
    // honest options are two, and that one of them is to stop. The second is
    // the unassigned case: a deal with no owner is not slow, it is unowned,
    // and telling its owner to hurry would be advice to nobody.
    instruction: [
      'Draft one short note per deal below, addressed to whoever owns it.',
      'Say how long it has sat and what the record shows was last done, then give two options and no third: assign an owner and move it, or pass and record the reason.',
      'Where a deal has no owner, say that first — an unowned deal is not a slow one, and there is nobody to chase.',
      'Use only the figures given. Never state an activity, a blocker or a next step the rows do not carry, and never propose a valuation or a decision.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?')
        .bind(userId).first<{ role: string | null }>();
      const role = String(me?.role || '');
      if (role !== 'admin' && role !== 'partner' && role !== 'investor') return [];
      // Amber at 14 days, which is `slaPreset('standard')` in the SPA's
      // `lib/dealFlow.js` — the same threshold the strip counts and the chip
      // row filters on, so the band never drafts about a deal the page does
      // not call stale.
      const rows = await c.env.DB.prepare(
        `SELECT p.name AS company, p.sector AS sector, d.status AS status,
                d.target_raise AS ask, d.amount AS amount,
                d.stage_changed_at AS since, lp.name AS owner
           FROM deals d
           LEFT JOIN projects p ON p.id = d.project_id
           LEFT JOIN users lp ON lp.id = d.lead_partner_id
          WHERE d.status <> 'rejected'
            AND (p.id IS NULL OR p.deleted_at IS NULL)
            AND d.stage_changed_at IS NOT NULL
            AND d.stage_changed_at <= datetime('now', '-14 days')
          ORDER BY d.stage_changed_at ASC LIMIT 40`
      ).bind().all<Record<string, unknown>>();
      return (rows.results || []).map((r) => {
        const days = Math.floor(
          (Date.now() - Date.parse(String(r.since).replace(' ', 'T') + 'Z')) / 86_400_000,
        );
        const ask = Number(r.ask) || Number(r.amount) || 0;
        return `${r.company || 'company not recorded'} — ${r.sector || 'sector not recorded'}; `
          + `status ${r.status}; ${Number.isFinite(days) ? `${days} days in stage` : 'time in stage not recorded'}; `
          + `${ask > 0 ? `asking $${Math.round(ask).toLocaleString('en-US')}` : 'ask not recorded'}; `
          + `${r.owner ? `owned by ${r.owner}` : 'NO OWNER RECORDED'}`;
      });
    },
  },

  'deals/screening': {
    // ID2's band: "Drafted against the six-dimension rubric with page
    // references back into the deck, so every claim in the memo can be
    // checked. Where the deck is silent on a dimension the memo says so
    // rather than scoring it zero."
    //
    // The page references are the half this product cannot honour — nothing
    // stores which page of a deck a sub-score came from — so the instruction
    // asks for the dimension totals as the citation instead, and forbids the
    // invention of a page number. The second clause is the one that matters
    // most: a model handed six numbers will fill a gap with a zero, and a
    // zero on a dimension nobody scored is a verdict the record never gave.
    instruction: [
      'Draft one screening memo for the highest-scoring deal below, organised by the six rubric dimensions in the order given.',
      'Cite the dimension total for every claim. Never cite a page, a slide or a document — nothing records which part of a deck a sub-score came from, and a page reference here would be invented.',
      'Where a dimension has no recorded total, say the rubric is silent on it. Do NOT score it zero: a zero is a verdict, and nobody gave it.',
      'Where the snapshot is flagged for review, open with that and say what kind of flag it is — a flag is the scorer disagreeing with itself, never a finding about the company.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?')
        .bind(userId).first<{ role: string | null }>();
      const role = String(me?.role || '');
      if (role !== 'admin' && role !== 'partner' && role !== 'investor') return [];
      // The newest OFFICIAL snapshot per project. A sandbox run is a rehearsal
      // and must not reach a memo — see the /deals/screening docblock.
      const rows = await c.env.DB.prepare(
        `SELECT p.name AS company, p.sector AS sector,
                s.total_score, s.tier, s.admin_review_status, s.anomaly_flags,
                s.market_total, s.team_total, s.product_total,
                s.capital_total, s.fit_total, s.distribution_total
           FROM deals d
           JOIN projects p ON p.id = d.project_id
           JOIN (SELECT project_id, MAX(created_at) AS created_at, total_score, tier,
                        admin_review_status, anomaly_flags,
                        market_total, team_total, product_total,
                        capital_total, fit_total, distribution_total
                   FROM score_snapshots WHERE is_sandbox = 0 GROUP BY project_id) s
                ON s.project_id = d.project_id
          WHERE d.status <> 'rejected' AND p.deleted_at IS NULL
          ORDER BY s.total_score DESC LIMIT 12`
      ).bind().all<Record<string, unknown>>();
      const DIMS = ['market', 'team', 'product', 'capital', 'fit', 'distribution'];
      return (rows.results || []).map((r) => {
        const dims = DIMS.map((d) => {
          const v = r[`${d}_total`];
          return `${d} ${v === null || v === undefined ? 'NOT SCORED' : v}`;
        }).join(', ');
        let flagged = '';
        if (r.admin_review_status === 'flagged') {
          let parsed: Array<{ type?: string; severity?: string }> = [];
          try { parsed = JSON.parse(String(r.anomaly_flags || '[]')); } catch { parsed = []; }
          flagged = `; FLAGGED FOR REVIEW (${(Array.isArray(parsed) ? parsed : [])
            .map((f) => `${f?.type || 'unnamed'}/${f?.severity || 'unrecorded'}`).join(', ') || 'flags not readable'})`;
        }
        return `${r.company || 'company not recorded'} — ${r.sector || 'sector not recorded'}; `
          + `total ${r.total_score ?? 'not recorded'}, tier ${r.tier || 'not recorded'}; ${dims}${flagged}`;
      });
    },
  },

  'deals/commit': {
    // ID3's band: "Proposal · IC memo from the pipeline — assembled from
    // everything the pipeline already holds ... Every figure traces to the row
    // it came from, so the memo can be audited rather than trusted."
    //
    // THE ARTBOARD'S OWN MEMO SAYS "1 recused" AND "Approved with conditions",
    // and neither is a thing this store can say. `ic_votes.vote` is
    // yes|no|abstain — an abstention is a vote CAST, a recusal is a declared
    // conflict that leaves the denominator — and no condition is stored
    // anywhere. A model handed a tally and asked for an IC memo will reach for
    // both, because that is what IC memos say, so both are forbidden outright
    // rather than left to judgement.
    //
    // The rationale instruction is the other half. A vote with no reason is
    // the most tempting gap in this material: the model knows the vote and can
    // write a plausible reason for it, and a plausible reason attributed to a
    // named partner is a fabricated quote in a governance record.
    instruction: [
      'Draft one investment-committee memo for the decision below, from the votes and their rationales.',
      'Attribute every reason to the partner who wrote it, quoting only what is given. Where a vote carries NO RATIONALE, say the vote was cast without a recorded reason. Never write the reason yourself: a reason put in a named partner’s mouth is a fabricated quote in a governance record.',
      'Never describe any vote as recused and never reduce the denominator: the record holds yes, no and abstain, an abstention is a vote cast rather than a conflict declared, and nothing stores a recusal.',
      'Never state a condition, a quorum or an approval-with-conditions: none of the three is stored, so any of them would be invented.',
      'Where the decision is still open, say so and do not predict the outcome.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?')
        .bind(userId).first<{ role: string | null }>();
      const role = String(me?.role || '');
      if (role !== 'admin' && role !== 'partner' && role !== 'investor') return [];
      // SCOPED THROUGH THE ONE HELPER THAT OWNS THE PREDICATE.
      // `scopedDecisions` is `routes/ic.ts`'s single list read; a draft surface
      // running its own `SELECT ... FROM ic_decisions` would be the second copy
      // that file's header warns about, and an unscoped one would hand another
      // committee's deliberations to a model on this caller's behalf — the hole
      // migration 219 closed, reopened through a side door.
      const found = await scopedDecisions(c.env, { id: userId, role } as any, 1);
      const d = found[0];
      if (!d) return [];
      const company = d.project_id
        ? await c.env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL')
          .bind(d.project_id).first<{ name: string }>().catch(() => null)
        : null;
      const head = `DECISION: ${d.title || 'title not recorded'}`
        + ` — ${company?.name || 'company not recorded'}; stage ${d.status || 'not recorded'}`
        + `; outcome ${d.decision || 'NOT CLOSED'}; ${d.votes.length} vote(s) cast`;
      return [head, ...d.votes.map((v) => {
        const reason = String(v.rationale || '').trim();
        return `${v.user_name || 'partner not recorded'} voted ${v.vote}`
          + ` — ${reason || 'NO RATIONALE RECORDED'}`;
      })];
    },
  },

  'deals/closing': {
    // ID4's band: "A one-page cover for counsel: what is executed, what
    // remains, and the single condition holding the transfer. States plainly
    // that the platform records the wire and the banks move it — the packet is
    // evidence, not a payment instruction."
    //
    // THE CONDITION IS THE HALF THIS PRODUCT CANNOT HONOUR, and the artboard
    // makes it the whole point of the note. Nothing stores an IC condition
    // (see the deals/commit surface above), so a model asked for "the single
    // condition holding the transfer" would write one — a fabricated legal
    // impediment in a document going to counsel. Forbidden outright.
    //
    // The second instruction is the artboard's own honesty and it must survive
    // the draft: this is a record of paper, not an instrument of payment. A
    // cover note that reads as a payment instruction is a different kind of
    // document with a different kind of consequence.
    instruction: [
      'Draft a one-page closing cover note for counsel from the envelopes below: what is executed, what is still out, and what the record does not cover.',
      'An envelope counts as executed ONLY where its state is completed. A signature count that has reached its recipient count is not the same thing, and an envelope with NO RECIPIENT RECORDED is not partially signed — say its recipients are unrecorded.',
      'Never state a condition, a blocker or anything holding the transfer: no condition is stored anywhere in this product, so any you name would be invented — and an invented legal impediment in a note to counsel is worse than an omission.',
      'Say plainly that the platform records the movement of money and does not move it. This note is evidence of paper, never a payment instruction.',
      'Add nothing the rows below do not support, and do not estimate a closing date.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
        .bind(userId).first<{ id: number; role: string | null }>();
      const role = String(me?.role || '');
      if (role !== 'admin' && role !== 'partner' && role !== 'investor') return [];
      // The SAME predicate `esign.get('/')` puts in its WHERE clause, from the
      // same shared helper — not a second copy of it. An envelope carries the
      // executed paper of a deal; an unscoped read here would hand one firm's
      // signed instruments to another firm's model.
      const scope = esignEnvelopeScope({ id: userId, role } as any);
      const rows = await c.env.DB.prepare(
        `SELECT e.document_title, e.document_type, e.status, e.completed_at, e.deal_id,
                (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id) AS recipient_count,
                (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed') AS signed_count
           FROM esign_envelopes e
          WHERE ${scope.sql} AND e.deal_id IS NOT NULL
          ORDER BY e.created_at DESC LIMIT 40`
      ).bind(...scope.binds).all<Record<string, unknown>>();
      const list = (rows.results || []) as Record<string, unknown>[];
      if (!list.length) return [];
      return list.map((e) => {
        const need = Number(e.recipient_count);
        const sigs = (Number.isFinite(need) && need > 0)
          ? `${Number(e.signed_count) || 0} of ${need} signed`
          : 'NO RECIPIENT RECORDED';
        return `${e.document_title || e.document_type || 'document not titled'}`
          + ` (deal ${e.deal_id}) — state ${e.status || 'not recorded'}; ${sigs};`
          + ` ${e.completed_at ? `completed ${e.completed_at}` : 'NOT EXECUTED'}`;
      });
    },
  },

  'portfolio/positions': {
    // IP1's band: "Proposal · explain the quarter's TVPI move", footed
    // "Traces to the mark-history rows."
    //
    // THE FOOTNOTE IS THE WHOLE DESIGN. A multiple moves because a MARK moved,
    // and `portfolio_marks` records each one with the date it speaks for, the
    // event behind it and the basis it was arrived at on. So the gather is the
    // mark history, and the instruction forbids the two ways a model turns that
    // into something the record did not say.
    //
    // FIRST: blending TVPI and DPI. The artboard's own note says why — an
    // unrealised multiple is a mark and a realised one is cash. A sentence that
    // adds them is a sentence about money that does not exist.
    //
    // SECOND: momentum. Given a list of marks a model will narrate a trend, and
    // a position held at last round did not move. Naming it as part of the
    // change turns two events into portfolio-wide drift.
    instruction: [
      'Explain how the portfolio multiple moved, from the marking events below and nothing else.',
      'Name the specific events that moved it, each with the company, the date the mark speaks for and its basis. A position with no mark in the period did NOT move: never describe it as contributing, and never call the change momentum or a trend when it rests on a handful of events.',
      'Never blend an unrealised multiple with a realised one — a mark is not cash. If you mention both, report them separately and say which is which.',
      'A mark whose basis is UNRECORDED has no stated provenance: say so rather than treating it as a GP estimate, which is what the column would otherwise default to.',
      'Add no figure the rows below do not carry, and do not forecast.',
    ].join(' '),
    gather: async (c, userId) => {
      const me = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
        .bind(userId).first<{ id: number; role: string | null }>();
      const role = String(me?.role || '');
      if (role !== 'admin' && role !== 'partner' && role !== 'investor') return [];
      // The same scope every read in `routes/positions.ts` uses. An empty
      // accessible set means an empty draft, never an unscoped one — the CSV
      // predicate treats NULL as "all rows", so [] must short-circuit here
      // rather than reach the query.
      const ids = await investorProjectIds(c.env, { id: userId, role } as any, null);
      if (ids != null && ids.length === 0) return [];
      const csv = ids == null ? null : ids.join(',');
      const rows = await c.env.DB.prepare(
        `SELECT m.as_of_date, m.fmv, m.post_money, m.event, m.basis, m.source,
                p.name AS project_name
           FROM portfolio_marks m
           JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(m.project_id AS TEXT) || ',') > 0)
          ORDER BY m.as_of_date DESC LIMIT 40`
      ).bind(csv, csv).all<Record<string, unknown>>();
      const list = (rows.results || []) as Record<string, unknown>[];
      if (!list.length) return [];
      return list.map((m) => (
        `${m.project_name || 'company not recorded'} — marked ${m.as_of_date || 'date not recorded'}`
        + `; FMV ${m.fmv ?? 'not recorded'}${m.post_money != null ? `, post-money ${m.post_money}` : ''}`
        + `; event ${m.event || 'not recorded'}`
        + `; basis ${m.basis || 'UNRECORDED'}`
        + `${m.source ? `; source ${m.source}` : ''}`
      ));
    },
  },

  // ── FOUNDER SURFACES ────────────────────────────────────────────────────
  //
  // The first non-partner entries in this table. Everything above scopes on
  // `users.partner_id`; each of these calls `founderProject` and returns []
  // when it does not resolve, which the route answers as `nothing_to_draft`.
  // A founder never sees another founder's material through here, and a
  // founder with two startups and no `scopeKey` gets nothing rather than a
  // draft about whichever one sorted first.

  'build/this-week': {
    // A3's band: "Proposal · Monday plan — drafted from what actually moved
    // last week: two cards shipped, the pricing card slipped twice."
    //
    // The instruction that matters is the second one. The store records a key
    // result's CURRENT and TARGET and nothing about who owns it or whether it
    // is at risk, so a model asked for a Monday plan will otherwise assign
    // names and hand out statuses it invented — which is exactly the shape of
    // the artboard's own fixture ("+ Ship async digest v1 · Amara") and
    // exactly what must not reach a real founder's week.
    instruction: [
      'Propose next week\'s commitments from the current objectives and open cards below.',
      'Never name an owner and never call a commitment on track or at risk: neither is recorded, and inventing one puts a name against work nobody agreed to.',
      'Where a key result has moved, say by how much using the figures given; where it has not, say it has not.',
      'Propose at most five commitments and add nothing the material below does not support.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const okrs = await c.env.DB.prepare(
        `SELECT objective, key_results_json, kanban_status, updated_at
           FROM roadmap_okrs WHERE project_id = ? AND kanban_status = 'now'
          ORDER BY sort_order, id LIMIT 50`
      ).bind(pid).all<{ objective: string; key_results_json: string | null; kanban_status: string; updated_at: string | null }>();
      const lines: string[] = [];
      for (const o of (okrs.results || [])) {
        let krs: any[] = [];
        try { krs = JSON.parse(o.key_results_json || '[]'); } catch { krs = []; }
        const parts = (Array.isArray(krs) ? krs : [])
          .filter((k) => k && String(k.text || '').trim())
          .map((k) => {
            const unit = k.unit ? ` ${k.unit}` : '';
            return k.target == null || k.target === ''
              ? `${k.text} (NO TARGET RECORDED)`
              : `${k.text} (${k.current ?? 'no current value recorded'} of ${k.target}${unit})`;
          });
        lines.push(`Objective now: ${o.objective}${parts.length ? ` — key results: ${parts.join('; ')}` : ' — no key results recorded'}`);
      }
      const cards = await c.env.DB.prepare(
        `SELECT t.title, t.status, t.due_date, t.updated_at
           FROM mvp_tasks t WHERE t.deal_id = ? AND t.status <> 'done'
          ORDER BY t.updated_at DESC LIMIT 40`
      ).bind(pid).all<{ title: string; status: string; due_date: string | null; updated_at: string | null }>();
      for (const t of (cards.results || [])) {
        lines.push(`Open card: ${t.title} — ${t.status.replace('_', ' ')}; `
          + `${t.due_date ? `due ${String(t.due_date).slice(0, 10)}` : 'no due date recorded'}; `
          + `last touched ${t.updated_at ? String(t.updated_at).slice(0, 10) : 'not recorded'}`);
      }
      return lines;
    },
  },

  'build/roadmap': {
    // A3's second band: "Proposal · tradeoff, reasoned — Slack integration and
    // the permissions model both sit in Q4 … Asked to reason it out, the model
    // argues for Slack first."
    //
    // This one is an ARGUMENT rather than a summary, and the artboard is
    // explicit that it costs twenty times a Monday plan for that reason. What
    // the instruction has to prevent is the argument being made from outside
    // the record — the canvas's own fixture reasons from interview counts, and
    // a roadmap gather has no interviews in it.
    instruction: [
      'Argue the ordering of the objectives below: name the one pair whose order is most worth changing, and give the reason.',
      'Reason only from what is recorded here — the horizon, the quarter, the key results and their progress. Do not cite interviews, customers, headcount or cost; none of it is in front of you.',
      'If nothing in the record argues for a different order, say so rather than manufacturing a tradeoff.',
      'State plainly that the ordering is the founder\'s to change and that accepting this changes nothing on its own.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const rows = await c.env.DB.prepare(
        `SELECT objective, key_results_json, kanban_status, quarter
           FROM roadmap_okrs WHERE project_id = ?
          ORDER BY CASE kanban_status WHEN 'now' THEN 0 WHEN 'next' THEN 1 ELSE 2 END, sort_order, id
          LIMIT 60`
      ).bind(pid).all<{ objective: string; key_results_json: string | null; kanban_status: string; quarter: string | null }>();
      return (rows.results || []).map((o) => {
        let krs: any[] = [];
        try { krs = JSON.parse(o.key_results_json || '[]'); } catch { krs = []; }
        const n = (Array.isArray(krs) ? krs : []).filter((k) => k && String(k.text || '').trim()).length;
        return `${o.objective} — horizon ${o.kanban_status}; `
          + `${o.quarter ? `quarter ${o.quarter}` : 'NO QUARTER RECORDED'}; `
          + `${n} key result${n === 1 ? '' : 's'}`;
      });
    },
  },

  'build/kpi': {
    // A3's third band: "Out of range · explain this? — Burn jumped 31% on last
    // month. Want a one-line annotation drafted … attached to this figure for
    // investor updates?"
    //
    // An annotation on a figure a founder will paste into an investor update is
    // the one place a confident invented cause does real damage, so the
    // instruction refuses a cause outright. Two snapshots is also the minimum
    // for the word "jumped" to mean anything: with one, there is no movement to
    // explain and the gather says so rather than letting the model treat a
    // single figure as a change.
    instruction: [
      'Draft one short annotation for the figure below that moved most between the two snapshots.',
      'State the movement and its size from the figures given. Do NOT state a cause: nothing here records why anything moved, and an invented reason goes into an investor update as fact.',
      'Where only one snapshot exists there is no movement — say that instead, and do not describe the single figure as a change.',
      'Name any figure the summary could not compute, and its stated reason, rather than treating a missing value as zero.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      await ensureMetricsSnapshotsSchema(c.env);
      const rows = await c.env.DB.prepare(
        `SELECT snapshot_date, mrr, paying_accounts, net_burn, cash_balance
           FROM metrics_snapshots WHERE project_id = ?
          ORDER BY snapshot_date DESC, id DESC LIMIT 2`
      ).bind(pid).all<{
        snapshot_date: string | null; mrr: number | null; paying_accounts: number | null;
        net_burn: number | null; cash_balance: number | null;
      }>();
      const snaps = rows.results || [];
      if (!snaps.length) return [];
      const fmt = (r: typeof snaps[number]) =>
        `Snapshot ${r.snapshot_date || 'date not recorded'}: `
        + `MRR ${r.mrr == null ? 'not recorded' : r.mrr}; `
        + `paid accounts ${r.paying_accounts == null ? 'not recorded' : r.paying_accounts}; `
        + `net burn ${r.net_burn == null ? 'not recorded' : r.net_burn}; `
        + `cash ${r.cash_balance == null ? 'not recorded' : r.cash_balance}`;
      const lines = snaps.map(fmt);
      if (snaps.length === 1) lines.push('ONLY ONE SNAPSHOT EXISTS — there is no prior figure to compare against.');
      return lines;
    },
  },

  'raise/capital': {
    // A4's band: "At $1.5M on a $12M post with a 12% pool top-up, you and Amara
    // go from 89.5% to 66.1% combined. The pool top-up costs you more dilution
    // than the round itself — 7.4 points against 16.0."
    //
    // The artboard is explicit that the reasoning is shown step by step
    // "because you will be asked to defend this number", and that is the
    // instruction that matters: a dilution figure a founder cannot reconstruct
    // in a partner meeting is worse than none. The second is that a round with
    // no pre-money recorded has no post-money and therefore no dilution at all
    // — computing one from the target alone would put a number in front of
    // someone who is about to defend it.
    instruction: [
      'Read the round below back in plain language, and show every step of the arithmetic.',
      'Where a figure the arithmetic needs is not recorded, say which one and stop: do not assume a pre-money, a pool or a share count.',
      'Name the largest single source of dilution and compare it against the others in points.',
      'Add no benchmark and no market comparison. Nothing here records what other rounds look like.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const round = await c.env.DB.prepare(
        `SELECT name, target_amount, pre_money, pro_rata_reserved, close_date, created_at
           FROM raise_rounds WHERE project_id = ? AND status = 'active'`
      ).bind(pid).first<{
        name: string | null; target_amount: number | null; pre_money: number | null;
        pro_rata_reserved: number | null; close_date: string | null; created_at: string | null;
      }>();
      const lines: string[] = [];
      if (round) {
        lines.push(`Round: ${round.name || 'unnamed'}; `
          + `target ${round.target_amount == null ? 'NOT RECORDED' : round.target_amount}; `
          + `pre-money ${round.pre_money == null ? 'NOT RECORDED' : round.pre_money}; `
          + `pro-rata reserved ${round.pro_rata_reserved == null ? 'NOT RECORDED' : round.pro_rata_reserved}; `
          + `close ${round.close_date || 'NOT RECORDED'}`);
      }
      const allocs = await c.env.DB.prepare(
        `SELECT COALESCE(commit_status, 'signed') AS state, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
           FROM raise_prospects WHERE project_id = ? AND stage = 'committed' AND amount IS NOT NULL
          GROUP BY COALESCE(commit_status, 'signed')`
      ).bind(pid).all<{ state: string; n: number; total: number }>();
      for (const a of (allocs.results || [])) {
        lines.push(`Committed as ${a.state}: ${a.n} allocation${a.n === 1 ? '' : 's'} totalling ${a.total}`);
      }
      const scenario = await c.env.DB.prepare(
        `SELECT name, inputs_json FROM cap_table_scenarios
          WHERE project_id = ? AND is_variant = 0 ORDER BY updated_at DESC LIMIT 1`
      ).bind(pid).first<{ name: string; inputs_json: string | null }>();
      if (scenario) lines.push(`Cap table scenario "${scenario.name}": ${String(scenario.inputs_json || '').slice(0, 1200)}`);
      else if (lines.length) lines.push('NO CAP TABLE SCENARIO IS RECORDED — there are no current ownership percentages to dilute.');
      return lines;
    },
  },

  'raise/legal': {
    // A4's band: "'Full ratchet anti-dilution' — off market at seed. Broad-based
    // weighted average is standard."
    //
    // THE DOCUMENT'S OWN TEXT IS THE MATERIAL, and it has to be: a clause read
    // from a title is a guess about a document. Bounded per document and
    // capped, because the point is the clauses and not the whole instrument.
    //
    // "Not legal advice. Counsel is on the Team page" is on the band's foot in
    // the page, and the instruction carries the same limit, because a founder
    // reading a confident paragraph about their own term sheet is exactly the
    // reader who will act on it.
    instruction: [
      'Name the clauses in the documents below that a founder should look at again, and say plainly what each one does to them.',
      'Quote the clause you are describing. Do not describe a clause that is not in the text.',
      'You are not counsel and this is not advice: say what the clause does, never what to sign or refuse.',
      'Where a document is a draft or unsigned, say so — its terms are not settled.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const rows = await c.env.DB.prepare(
        `SELECT title, doc_type, status, content FROM documents
          WHERE project_id = ? ORDER BY updated_at DESC LIMIT 8`
      ).bind(pid).all<{ title: string; doc_type: string; status: string; content: string | null }>();
      return (rows.results || []).map((d) => {
        const body = String(d.content || '').trim();
        return `${d.title} (${d.doc_type}, ${d.status})\n`
          + (body ? body.slice(0, 4000) : 'NO TEXT STORED — this document has a record but no body to read.');
      });
    },
  },

  'raise/data-room': {
    // A4's band: "Seed investors in workflow software ask for three things you
    // don't have staged … Two of the four investors already viewing have
    // requested the first."
    //
    // The artboard's version reasons from what investors in a sector ask for,
    // which nothing here records — so this one reasons from the room instead:
    // what is staged, what is behind NDA, and what the people with access have
    // actually opened. A model told to name gaps and handed only a file list
    // will otherwise recite a generic diligence checklist as though it had read
    // this founder's room.
    instruction: [
      'Describe what this data room does and does not hold, from the list below alone.',
      'Do not produce a generic diligence checklist: name only gaps the room itself evidences — a folder with nothing in it, a document referred to by a file name that is not there, an artifact behind NDA that everyone with access already signed for.',
      'Say what each investor with access has and has not opened, where that is recorded.',
      'If the room looks complete for what it holds, say so rather than inventing something missing.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const folders = await c.env.DB.prepare(
        `SELECT f.name, f.visibility,
                (SELECT COUNT(*) FROM data_room_files x WHERE x.folder_id = f.id) AS files
           FROM data_room_folders f WHERE f.project_id = ? ORDER BY f.display_order, f.name LIMIT 60`
      ).bind(pid).all<{ name: string; visibility: string; files: number }>();
      const files = await c.env.DB.prepare(
        `SELECT f.name, f.visibility,
                (SELECT COUNT(DISTINCT l.user_id) FROM data_room_access_log l WHERE l.file_id = f.id) AS viewers
           FROM data_room_files f WHERE f.project_id = ? ORDER BY f.name LIMIT 120`
      ).bind(pid).all<{ name: string; visibility: string; viewers: number }>();
      const grants = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM data_room_grants WHERE project_id = ? AND status = 'active'`
      ).bind(pid).first<{ n: number }>();
      const lines: string[] = [];
      for (const f of (folders.results || [])) {
        lines.push(`Folder ${f.name} (${f.visibility}) — ${f.files} file${f.files === 1 ? '' : 's'}`);
      }
      for (const f of (files.results || [])) {
        lines.push(`File ${f.name} (${f.visibility}) — `
          + `${f.viewers ? `opened by ${f.viewers} investor${f.viewers === 1 ? '' : 's'}` : 'never opened'}`);
      }
      if (lines.length) {
        lines.push(`${Number(grants?.n || 0)} investor${Number(grants?.n || 0) === 1 ? '' : 's'} currently have access.`);
      }
      return lines;
    },
  },

  'raise/liquidity': {
    // A4's band sits beside a waterfall the product cannot draw: no exit model
    // and no preference terms are stored anywhere, so the page says so. What
    // this band has is the cap table and the round — enough to answer the one
    // question the zone exists for, which the artboard states outright: the
    // waterfall should be understood BEFORE terms are signed, not after.
    //
    // So the instruction is mostly a set of refusals. A model asked about exits
    // will supply a preference stack, a participation multiple and a comparable
    // outcome, and each of those would be a term this founder has not agreed to
    // presented as one they have.
    instruction: [
      'Explain who is paid what, and in what order, at an exit — using only the ownership and round figures below.',
      'No preference multiple, participation right or liquidation term is recorded anywhere here. Do not assume one, and do not describe a standard one as though it applied to this company.',
      'Name every input the answer would need that is missing, and say plainly that the order of payment cannot be settled without them.',
      'Model no exit price that is not given. If none is given, describe the mechanism rather than inventing an outcome.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const scenario = await c.env.DB.prepare(
        `SELECT name, inputs_json, result_json FROM cap_table_scenarios
          WHERE project_id = ? AND is_variant = 0 ORDER BY updated_at DESC LIMIT 1`
      ).bind(pid).first<{ name: string; inputs_json: string | null; result_json: string | null }>();
      if (!scenario) return [];
      const round = await c.env.DB.prepare(
        `SELECT name, target_amount, pre_money FROM raise_rounds WHERE project_id = ? AND status = 'active'`
      ).bind(pid).first<{ name: string | null; target_amount: number | null; pre_money: number | null }>();
      const lines = [
        `Cap table scenario "${scenario.name}" inputs: ${String(scenario.inputs_json || '').slice(0, 1500)}`,
        `Computed ownership: ${String(scenario.result_json || 'NOT COMPUTED').slice(0, 1500)}`,
      ];
      lines.push(round
        ? `Open round: ${round.name || 'unnamed'}; target ${round.target_amount ?? 'NOT RECORDED'}; pre-money ${round.pre_money ?? 'NOT RECORDED'}`
        : 'NO OPEN ROUND IS RECORDED.');
      lines.push('NO LIQUIDATION PREFERENCE, PARTICIPATION RIGHT OR EXIT MODEL IS RECORDED for this company.');
      return lines;
    },
  },

  'grow/customers': {
    // A5's band: "Segment: platform leads at 50-200 engineer orgs, cold, no
    // reply in 14 days. + 3-touch sequence, each opening on the
    // handoff-opacity pain THEIR OWN SEGMENT NAMED in your interviews."
    //
    // The italics are the artboard's and they are the whole instruction. A
    // model asked for outreach copy writes a generic cold email; what makes
    // this one worth the tokens is that it opens on something the recipient's
    // own segment said. So the material carries the founder's recorded pains
    // alongside the signups, and the instruction requires the opening line to
    // come from one of them or to say that none applies.
    //
    // THE FUNNEL HAS FOUR STAGES, NOT THE ARTBOARD'S FIVE. `crm_status` is
    // new / invited / followed_up / promoted (`routes/progress.ts`), and a
    // model handed "Demo", "Trial" and "Paid" would place people in stages
    // this product cannot record them in.
    instruction: [
      'Draft one outreach sequence for the signups below who have gone furthest without converting.',
      'Open each touch on a pain the founder has actually recorded, quoting it. If no recorded pain fits the segment, say so and write no opener rather than inventing one.',
      'Use only the four stages the record has — new, invited, followed up, promoted. Do not place anyone at a demo, a trial or a paid plan: none of those is recorded.',
      'Name no company and no person the list below does not name.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const stages = await c.env.DB.prepare(
        `SELECT COALESCE(crm_status, 'new') AS stage, COALESCE(source, 'source not recorded') AS source,
                COUNT(*) AS n, MAX(created_at) AS latest
           FROM waitlist_signups WHERE project_id = ?
          GROUP BY COALESCE(crm_status, 'new'), COALESCE(source, 'source not recorded')
          ORDER BY n DESC LIMIT 40`
      ).bind(pid).all<{ stage: string; source: string; n: number; latest: string | null }>();
      const lines = (stages.results || []).map((r) =>
        `${r.n} signup${r.n === 1 ? '' : 's'} at stage "${r.stage.replace('_', ' ')}" from ${r.source}; `
        + `most recent ${r.latest ? String(r.latest).slice(0, 10) : 'not recorded'}`);
      if (!lines.length) return [];
      // The founder's OWN pain map: a group's title plus how many distinct
      // phrases they have filed under it. Grouping is the founder's act — the
      // Validate desk never names a theme for them — so a title here is
      // something they wrote, not something a model decided.
      const pains = await c.env.DB.prepare(
        `SELECT g.title,
                (SELECT COUNT(*) FROM pain_group_aliases a WHERE a.group_id = g.id) AS phrases
           FROM pain_groups g WHERE g.project_id = ?
          ORDER BY phrases DESC, g.sort_order LIMIT 12`
      ).bind(pid).all<{ title: string; phrases: number }>();
      const painLines = (pains.results || []).map((r) =>
        `Recorded pain: "${r.title}" — ${r.phrases} phrase${r.phrases === 1 ? '' : 's'} grouped under it`);
      lines.push(painLines.length
        ? painLines.join('\n')
        : 'NO PAIN IS RECORDED for this startup — there is nothing a touch can open on.');
      return lines;
    },
  },

  'grow/talent': {
    // A5's band: "Ranked first of 14 on three receipts you can check: shipped
    // an event-sourced handoff system at Verwood, applied through your careers
    // page rather than a board, and names async workflows in her own words."
    //
    // "RECEIPTS YOU CAN CHECK" is the instruction. An applicant record holds a
    // cover note, a link and a resume key — no score, no skills breakdown, no
    // inference. So a reason has to be a thing the founder can open and read
    // for themselves, and anything the model would have to conclude on its own
    // is exactly what must not appear as a ranking.
    //
    // AND MOVING SOMEONE TO SCREEN IS NOT AN ACTION HERE. Nothing writes
    // `job_applications.status` through any route, so the band produces a
    // reading and the founder acts on it in Talent.
    instruction: [
      'Rank the applicants below and give the reasons for the top one.',
      'Every reason must be a receipt the founder can open and check for themselves — something written in the application. Do not infer seniority, culture fit or ability from anything not stated.',
      'Where an application is thin, say what is missing rather than filling it in.',
      'Do not say anyone has been moved to a screen or to any other stage. Nothing here changes an application.',
    ].join(' '),
    gather: async (c, userId, scope) => {
      const pid = await founderProject(c, userId, scope);
      if (pid == null) return [];
      const posts = await c.env.DB.prepare(
        `SELECT id, title, seniority, status FROM job_postings
          WHERE project_id = ? AND status <> 'draft' ORDER BY created_at DESC LIMIT 10`
      ).bind(pid).all<{ id: number; title: string; seniority: string; status: string }>();
      const lines: string[] = [];
      for (const post of (posts.results || [])) {
        const apps = await c.env.DB.prepare(
          `SELECT name, cover_note, linkedin_url, portfolio_url, resume_key, status, created_at
             FROM job_applications WHERE posting_id = ? ORDER BY created_at DESC LIMIT 40`
        ).bind(post.id).all<{
          name: string | null; cover_note: string | null; linkedin_url: string | null;
          portfolio_url: string | null; resume_key: string | null; status: string; created_at: string;
        }>();
        const rows = apps.results || [];
        lines.push(`Role: ${post.title} (${post.seniority}, ${post.status}) — `
          + `${rows.length} applicant${rows.length === 1 ? '' : 's'}`);
        for (const a of rows) {
          // The APPLICANT'S EMAIL IS DELIBERATELY NOT HERE. It identifies a
          // real person to a third-party model and adds nothing a ranking can
          // use; the name and what they wrote are the material.
          lines.push(`  Applicant ${a.name || 'name not given'} (${a.status}, applied ${String(a.created_at).slice(0, 10)}): `
            + `${a.cover_note ? `wrote "${String(a.cover_note).slice(0, 600)}"` : 'NO COVER NOTE'}; `
            + `${a.linkedin_url ? 'linkedin given' : 'no linkedin'}; `
            + `${a.portfolio_url ? 'portfolio given' : 'no portfolio'}; `
            + `${a.resume_key ? 'resume attached' : 'NO RESUME'}`);
        }
      }
      return lines;
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

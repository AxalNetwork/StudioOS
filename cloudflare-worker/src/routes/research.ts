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
 * WHAT IS NOT HERE: a founder cannot push a document to an advisor. That
 * needs a grant type that does not exist (`data_room_grants` is the shape, but
 * its column is `investor_user_id`), and it is a decision about a founder's
 * privacy rather than a schema change. The zones say so rather than implying
 * an empty list means nobody shared anything.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { Jobs } from '../models/jobs';
import { mintDownloadToken } from '../services/signedDownload';
import { searchSemantic, deleteChunkedEntity, researchNamespace } from '../services/vectorize';
import { run as runAI } from '../services/aiRouter';

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

const dto = (r: DocRow) => ({
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
  const items = (rows.results || []).map(dto);
  return c.json({
    items,
    // The library's own reach, stated rather than left for a reader to count.
    indexed: items.filter((i) => i.index_state === 'indexed').length,
    not_indexed: items.filter((i) => i.index_state !== 'indexed').length,
    score_floor: SCORE_FLOOR,
  });
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
research.post('/ask', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const question = String(body?.question || '').trim().slice(0, 1000);
  if (!question) return c.json({ detail: 'question_required' }, 400);

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
    return c.json({
      question,
      answer: null,
      reason: 'no_source',
      // The difference between "your library is empty" and "your library has
      // nothing on this" is the whole message, and the page renders each
      // differently.
      indexed_documents: indexed?.n ?? 0,
      best_score: hits.length ? Number(hits[0].score.toFixed(3)) : null,
      score_floor: SCORE_FLOOR,
      citations: [],
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
  } catch (e) {
    console.error('[research] ask failed:', (e as Error).message);
  }

  if (!answer) {
    // The retrieval worked and the model did not. Reporting that as
    // `no_source` would blame the library for a failure that is not its.
    return c.json({
      question, answer: null, reason: 'model_unavailable',
      citations: usable.map((h) => ({ title: h.title, chunk: h.chunk ?? null, score: Number(h.score.toFixed(3)) })),
      score_floor: SCORE_FLOOR,
    });
  }

  return c.json({
    question,
    answer,
    reason: 'answered',
    citations: usable.map((h, i) => ({
      n: i + 1,
      title: h.title,
      chunk: h.chunk ?? null,
      score: Number(h.score.toFixed(3)),
    })),
    score_floor: SCORE_FLOOR,
  });
});

export default research;

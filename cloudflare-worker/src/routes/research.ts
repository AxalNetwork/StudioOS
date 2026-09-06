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

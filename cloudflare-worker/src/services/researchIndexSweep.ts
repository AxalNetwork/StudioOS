/** #5350 retries stranded Research indexing and upgrades pre-D4605 vectors in bounded hourly batches. */
import type { Env } from '../types';
import { Jobs } from '../models/jobs';

export const RESEARCH_PENDING_STALE_MINUTES = 60;
export const RESEARCH_PENDING_LIMIT = 20;
export const RESEARCH_ATTEMPT_LIMIT = 3;
export const RESEARCH_LEGACY_LIMIT = 20;
const LEGACY_CURSOR_KEY = 'axal-search:research-legacy-cursor:v1';
const FAILED_NOTE = `Indexing stopped after ${RESEARCH_ATTEMPT_LIMIT} attempts. Use Re-index to try again.`;

type DocumentRow = { id: number; indexed_at?: string | null };
type JobRow = { id: number; document_id: number; status: string; attempts: number; max_retries: number; created_at: string; updated_at: string };

export interface ResearchIndexSweepResult {
  pending_scanned: number;
  pending_enqueued: number;
  pending_requeued: number;
  pending_failed: number;
  legacy_scanned: number;
  legacy_enqueued: number;
  legacy_already_queued: number;
  legacy_done: boolean;
}

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

async function jobsFor(env: Env, ids: number[]): Promise<Map<number, JobRow[]>> {
  const out = new Map<number, JobRow[]>();
  if (!ids.length) return out;
  const rows = (await env.DB.prepare(
    `SELECT q.id,
            CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload, '$.id') AS INTEGER) END AS document_id,
            q.status, q.attempts, q.max_retries, q.created_at, q.updated_at
       FROM queue_jobs q JOIN json_each(?) wanted
         ON wanted.value = CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload, '$.id') AS INTEGER) END
      WHERE q.job_type = 'embed_entity'
        AND CASE WHEN json_valid(q.payload) THEN json_extract(q.payload, '$.type') END = 'research_doc'
      ORDER BY q.id DESC`,
  ).bind(JSON.stringify(ids)).all<JobRow>()).results ?? [];
  for (const row of rows) {
    const list = out.get(Number(row.document_id)) ?? [];
    list.push(row);
    out.set(Number(row.document_id), list);
  }
  return out;
}

async function failDocument(env: Env, id: number, at: string) {
  await env.DB.prepare(
    `UPDATE research_documents SET index_state = 'failed', index_note = ?, updated_at = ?
      WHERE id = ? AND index_state = 'pending'`,
  ).bind(FAILED_NOTE, at, id).run();
}

async function retryPending(env: Env, now: Date, result: ResearchIndexSweepResult) {
  const at = sqlTime(now);
  const cutoff = sqlTime(new Date(now.getTime() - RESEARCH_PENDING_STALE_MINUTES * 60_000));
  const docs = (await env.DB.prepare(
    `SELECT d.id, d.indexed_at FROM research_documents d
      WHERE d.index_state = 'pending' AND d.updated_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM queue_jobs q
           WHERE q.job_type = 'embed_entity'
             AND CASE WHEN json_valid(q.payload) THEN json_extract(q.payload, '$.type') END = 'research_doc'
             AND CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload, '$.id') AS INTEGER) END = d.id
            AND (q.status = 'pending' OR (q.status = 'processing' AND q.updated_at > ?))
        )
      ORDER BY d.id LIMIT ?`,
  ).bind(cutoff, cutoff, RESEARCH_PENDING_LIMIT).all<DocumentRow>()).results ?? [];
  result.pending_scanned = docs.length;
  const jobs = await jobsFor(env, docs.map((d) => d.id));
  for (const doc of docs) {
    // A manual re-index keeps the last successful `indexed_at`. Attempts from
    // that completed revision are history, not attempts of this pending run.
    const history = (jobs.get(doc.id) ?? []).filter((job) => !doc.indexed_at || job.created_at > doc.indexed_at);
    const attempts = history.reduce((sum, job) => sum + Math.max(0, Number(job.attempts) || 0), 0);
    const staleProcessing = history.find((job) => job.status === 'processing');
    if (staleProcessing && attempts < RESEARCH_ATTEMPT_LIMIT) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE queue_jobs SET status = 'pending', started_at = NULL, error = NULL, updated_at = ?
            WHERE id = ? AND status = 'processing' AND updated_at <= ?`,
        ).bind(at, staleProcessing.id, cutoff),
        env.DB.prepare(
          `UPDATE research_documents SET updated_at = ? WHERE id = ? AND index_state = 'pending'`,
        ).bind(at, doc.id),
      ]);
      result.pending_requeued += 1;
      continue;
    }
    if (attempts >= RESEARCH_ATTEMPT_LIMIT) {
      if (staleProcessing) {
        // Make the existing job's normal failure path exhaust it and record its DLQ row.
        await env.DB.prepare('UPDATE queue_jobs SET max_retries = attempts WHERE id = ?').bind(staleProcessing.id).run();
        await Jobs.markFailed(env, staleProcessing.id, 'research_index_retry_exhausted');
      }
      await failDocument(env, doc.id, at);
      result.pending_failed += 1;
      continue;
    }
    try {
      await Jobs.enqueue(env, 'embed_entity', { type: 'research_doc', id: doc.id }, {
        max_retries: Math.max(1, RESEARCH_ATTEMPT_LIMIT - attempts),
      });
      await env.DB.prepare(
        `UPDATE research_documents SET updated_at = ? WHERE id = ? AND index_state = 'pending'`,
      ).bind(at, doc.id).run();
      result.pending_enqueued += 1;
    } catch {
      // Keep the old timestamp: the next hourly tick may retry the enqueue.
    }
  }
}

async function legacyCursor(env: Env): Promise<number | 'done'> {
  try {
    const raw = await env.RATE_LIMITS.get(LEGACY_CURSOR_KEY);
    if (raw === 'done') return 'done';
    return raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  } catch { return 0; }
}

async function upgradeLegacy(env: Env, now: Date, result: ResearchIndexSweepResult) {
  if (!env.VECTORIZE) return;
  const cursor = await legacyCursor(env);
  if (cursor === 'done') { result.legacy_done = true; return; }
  const docs = (await env.DB.prepare(
    `SELECT id, indexed_at FROM research_documents
      WHERE index_state = 'indexed' AND id > ? ORDER BY id LIMIT ?`,
  ).bind(cursor, RESEARCH_LEGACY_LIMIT).all<DocumentRow>()).results ?? [];
  result.legacy_scanned = docs.length;
  if (!docs.length) {
    try { await env.RATE_LIMITS.put(LEGACY_CURSOR_KEY, 'done'); result.legacy_done = true; } catch {}
    return;
  }
  let vectors: VectorizeVector[];
  try { vectors = await env.VECTORIZE.getByIds(docs.map((doc) => `research_doc:${doc.id}:0`)); }
  catch { return; }
  const byId = new Map(vectors.map((vector) => [String(vector.id), vector]));
  const legacy = docs.filter((doc) => {
    const vector = byId.get(`research_doc:${doc.id}:0`);
    const revision = vector?.metadata?.revision;
    return typeof revision !== 'string' || !revision || revision !== doc.indexed_at;
  });
  const histories = await jobsFor(env, legacy.map((doc) => doc.id));
  const at = sqlTime(now);
  const statements: D1PreparedStatement[] = [];
  for (const doc of legacy) {
    const alreadyQueued = (histories.get(doc.id) ?? []).some((job) => job.status === 'pending' || job.status === 'processing');
    if (alreadyQueued) {
      statements.push(env.DB.prepare(
        `UPDATE research_documents SET index_state = 'pending', index_note = NULL, updated_at = ?
          WHERE id = ? AND index_state = 'indexed'`,
      ).bind(at, doc.id));
      result.legacy_already_queued += 1;
      continue;
    }
    const payload = JSON.stringify({ type: 'research_doc', id: doc.id });
    statements.push(
      env.DB.prepare(
        `INSERT INTO queue_jobs (job_type, payload, status, attempts, max_retries, created_at, updated_at)
         SELECT 'embed_entity', ?, 'pending', 0, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM research_documents WHERE id = ? AND index_state = 'indexed')
            AND NOT EXISTS (
              SELECT 1 FROM queue_jobs q
               WHERE q.job_type = 'embed_entity'
                 AND CASE WHEN json_valid(q.payload) THEN json_extract(q.payload, '$.type') END = 'research_doc'
                 AND CASE WHEN json_valid(q.payload) THEN CAST(json_extract(q.payload, '$.id') AS INTEGER) END = ?
                AND q.status IN ('pending', 'processing')
            )`,
      ).bind(payload, RESEARCH_ATTEMPT_LIMIT, at, at, doc.id, doc.id),
      env.DB.prepare(
        `UPDATE research_documents SET index_state = 'pending', index_note = NULL, updated_at = ?
          WHERE id = ? AND index_state = 'indexed'`,
      ).bind(at, doc.id),
    );
    result.legacy_enqueued += 1;
  }
  if (statements.length) await env.DB.batch(statements);
  const last = docs[docs.length - 1].id;
  try {
    await env.RATE_LIMITS.put(LEGACY_CURSOR_KEY, docs.length < RESEARCH_LEGACY_LIMIT ? 'done' : String(last));
    result.legacy_done = docs.length < RESEARCH_LEGACY_LIMIT;
  } catch {}
}

/** Run once on the existing minute-7 hourly tick; every read and write is bounded. */
export async function sweepResearchIndex(env: Env, now = new Date()): Promise<ResearchIndexSweepResult> {
  const result: ResearchIndexSweepResult = {
    pending_scanned: 0, pending_enqueued: 0, pending_requeued: 0, pending_failed: 0,
    legacy_scanned: 0, legacy_enqueued: 0, legacy_already_queued: 0, legacy_done: false,
  };
  await retryPending(env, now, result);
  await upgradeLegacy(env, now, result);
  return result;
}

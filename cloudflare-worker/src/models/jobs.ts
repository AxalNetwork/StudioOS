/**
 * Job queue model — D1-backed async work.
 *
 * Lifecycle: pending → processing → (completed | failed)
 *   - failed jobs with attempts < max_retries are re-pickup-able
 *   - failed jobs with attempts >= max_retries are dead-lettered
 */
import type { Env } from '../types';

export type JobType =
  | 'ai_scoring'
  | 'spinout_processing'
  | 'metrics_aggregation'
  | 'capital_call'
  | 'pipeline_advance'
  | 'traction_review'
  | 'liquidity_valuation'
  | 'liquidity_matching'
  | 'lpa_generation'
  | 'capital_call_notice'
  | 'returns_distribution';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: number;
  job_type: JobType;
  payload: string | null;
  status: JobStatus;
  attempts: number;
  max_retries: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  dead_at: string | null;
}

export const Jobs = {
  async enqueue(env: Env, jobType: JobType, payload: any, opts?: { max_retries?: number }) {
    const r = await env.DB.prepare(
      `INSERT INTO queue_jobs (job_type, payload, status, attempts, max_retries)
       VALUES (?, ?, 'pending', 0, ?) RETURNING *`
    ).bind(jobType, JSON.stringify(payload ?? {}), opts?.max_retries ?? 3).first<QueueJob>();
    return r;
  },

  /** Atomically claim up to `n` pending jobs. Uses UPDATE...RETURNING (D1 supports it). */
  async claimBatch(env: Env, n = 10): Promise<QueueJob[]> {
    // SQLite/D1 lacks SKIP LOCKED, so we do a guarded UPDATE on rowids we just read.
    const pending = await env.DB.prepare(
      `SELECT id FROM queue_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT ?`
    ).bind(n).all<{ id: number }>();
    const ids = (pending.results || []).map(r => r.id);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const claimed = await env.DB.prepare(
      `UPDATE queue_jobs
       SET status = 'processing', attempts = attempts + 1,
           started_at = datetime('now'), updated_at = datetime('now')
       WHERE id IN (${placeholders}) AND status = 'pending'
       RETURNING *`
    ).bind(...ids).all<QueueJob>();
    return claimed.results || [];
  },

  async markCompleted(env: Env, id: number) {
    await env.DB.prepare(
      `UPDATE queue_jobs SET status = 'completed',
       completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).bind(id).run();
  },

  async markFailed(env: Env, id: number, errMsg: string) {
    // If attempts >= max_retries → dead-letter; else mark failed (will be retried by re-claim logic if you choose).
    const job = await env.DB.prepare(`SELECT * FROM queue_jobs WHERE id = ?`).bind(id).first<QueueJob>();
    if (!job) return;
    const exhausted = job.attempts >= job.max_retries;
    await env.DB.prepare(
      `UPDATE queue_jobs SET status = ?, error = ?, dead_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(exhausted ? 'failed' : 'pending', errMsg.slice(0, 1000), exhausted ? new Date().toISOString() : null, id).run();
    if (exhausted) {
      await env.DB.prepare(
        `INSERT INTO dead_letter_queue (original_job_id, job_type, payload, last_error, attempts)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, job.job_type, job.payload, errMsg.slice(0, 1000), job.attempts).run();
    }
  },

  async stats(env: Env) {
    const r = await env.DB.prepare(
      `SELECT status, COUNT(*) as n FROM queue_jobs GROUP BY status`
    ).all<{ status: JobStatus; n: number }>();
    const byType = await env.DB.prepare(
      `SELECT job_type, status, COUNT(*) as n FROM queue_jobs
       WHERE created_at > datetime('now', '-1 day')
       GROUP BY job_type, status`
    ).all<{ job_type: string; status: string; n: number }>();
    const recent = await env.DB.prepare(
      `SELECT id, job_type, status, attempts, error, created_at, started_at, completed_at
       FROM queue_jobs ORDER BY id DESC LIMIT 50`
    ).all<QueueJob>();
    const dlq = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM dead_letter_queue WHERE moved_at > datetime('now','-7 days')`
    ).first<{ n: number }>();
    return {
      by_status: r.results || [],
      by_type: byType.results || [],
      recent: recent.results || [],
      dlq_7d: dlq?.n ?? 0,
    };
  },

  async cleanup(env: Env) {
    await env.DB.prepare(
      `DELETE FROM queue_jobs WHERE status IN ('completed','failed') AND created_at < datetime('now','-7 days')`
    ).run();
    await env.DB.prepare(
      `DELETE FROM dead_letter_queue WHERE moved_at < datetime('now','-30 days')`
    ).run();
  },
};

/**
 * Task #14 (AA-1) — Per-source quota tracker.
 *
 * Connectors call `bumpQuota` on every external request and `markRateLimited`
 * when the provider returns 429. The aggregator consults `isExhausted` before
 * dispatching a source so a tripped provider degrades to "stub" gracefully
 * rather than burning the daily allowance.
 */
import type { Env } from '../../types';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function bumpQuota(env: Env, source_key: string, opts: { error?: boolean; cap?: number } = {}): Promise<void> {
  const day = todayUtc();
  const cap = opts.cap ?? 1000;
  try {
    await env.DB.prepare(
      `INSERT INTO market_intel_quota (source_key, day, calls, errors, cap)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(source_key, day) DO UPDATE SET
         calls = calls + 1,
         errors = errors + excluded.errors`
    ).bind(source_key, day, opts.error ? 1 : 0, cap).run();
  } catch {
    /* tracker is best-effort */
  }
}

export async function markRateLimited(env: Env, source_key: string): Promise<void> {
  const day = todayUtc();
  try {
    await env.DB.prepare(
      `INSERT INTO market_intel_quota (source_key, day, calls, errors, cap, last_429_at)
       VALUES (?, ?, 0, 1, 1000, datetime('now'))
       ON CONFLICT(source_key, day) DO UPDATE SET
         errors = errors + 1,
         last_429_at = datetime('now')`
    ).bind(source_key, day).run();
  } catch {}
}

export async function isExhausted(env: Env, source_key: string): Promise<boolean> {
  const day = todayUtc();
  try {
    const row = await env.DB.prepare(
      `SELECT calls, cap, last_429_at FROM market_intel_quota WHERE source_key=? AND day=?`
    ).bind(source_key, day).first<{ calls: number; cap: number; last_429_at: string | null }>();
    if (!row) return false;
    if (row.calls >= row.cap) return true;
    // If we hit a 429 in the last hour, back off for the rest of the day.
    if (row.last_429_at) {
      const age = Date.now() - new Date(row.last_429_at + 'Z').getTime();
      if (age < 60 * 60 * 1000) return true;
    }
    return false;
  } catch {
    return false;
  }
}

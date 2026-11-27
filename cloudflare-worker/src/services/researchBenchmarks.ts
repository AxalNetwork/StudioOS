/**
 * A Research benchmark row and its detail read (migrations 217 and 303), shared
 * by the benchmark routes in `routes/research.ts` and the fund-figure routes in
 * `routes/research_benchmark_funds.ts` (D6278).
 *
 * Every read is owner-scoped: a uid that is not the caller's answers as one
 * that does not exist. `our_from` says where "Ours" came from — null when it
 * was typed on the row, or the fund, metric and date it was copied from. The
 * fund's name is shown only while the caller can still read that fund.
 */
import type { Context } from 'hono';
import type { Env } from '../types';
import { readableFunds } from './readableFunds';

export interface BenchRow {
  id: number; uid: string; owner_user_id: number; metric: string;
  our_value: string | null; peer_value: string | null; peer_source: string | null;
  peer_sample_size: number | null; peer_as_of: string | null; reading: string | null;
  fund_id: number | null; our_value_metric: string | null; our_value_as_of: string | null;
  created_at: string; updated_at: string;
}

/** The two fund figures a benchmark's "Ours" may be copied from (owner answer on #6278). */
export const OURS_FUND_METRICS = ['tvpi', 'dpi'] as const;
export type OursFundMetric = typeof OURS_FUND_METRICS[number];

export const benchDto = (r: BenchRow) => ({
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
  // D6278: null means "As entered on this row".
  our_from: r.fund_id && r.our_value_metric
    ? { fund_id: Number(r.fund_id), fund_name: null as string | null, metric: r.our_value_metric, as_of: r.our_value_as_of }
    : null,
  created_at: r.created_at,
});

const BENCH_THIN_AT = 10;
export const BENCHMARK_NOT_FOUND = 'This benchmark is not on your list.';
export const PEER_BASE_REQUIRED = 'A peer figure needs its source and its sample size. A benchmark presented '
  + 'without its base is arithmetic wearing a metric’s clothes.';

/** The six fields and the reading: what a restatement changes, and what history keeps. */
export const HISTORY_FIELDS = [
  'metric', 'our_value', 'peer_value', 'peer_source', 'peer_sample_size', 'peer_as_of', 'reading',
] as const;
type HistoryField = typeof HISTORY_FIELDS[number];
export type BenchValues = Pick<BenchRow, HistoryField>;

const same = (a: unknown, b: unknown) =>
  (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));

/** True when `next` restates any of the six fields or the reading of `row`. */
export function benchmarkChanged(row: BenchRow, next: Record<HistoryField, unknown>): boolean {
  return HISTORY_FIELDS.some((k) => !same(row[k], next[k]));
}

/**
 * The statement that copies the caller's stored row, as it is before a change
 * made at `changedAt`, into its history. Batch it AHEAD of the update.
 */
export function historySnapshot(env: Env, benchmarkId: number, userId: number, changedAt: string) {
  return env.DB.prepare(
    `INSERT INTO research_benchmark_history
       (benchmark_id, owner_user_id, metric, our_value, peer_value, peer_source,
        peer_sample_size, peer_as_of, reading, changed_at)
     SELECT id, owner_user_id, metric, our_value, peer_value, peer_source,
            peer_sample_size, peer_as_of, reading, ?
       FROM research_benchmarks WHERE id = ? AND owner_user_id = ?`
  ).bind(changedAt, benchmarkId, userId);
}

interface HistoryRow extends BenchValues { changed_at: string }

const historyDto = (r: HistoryRow) => ({
  metric: r.metric,
  our_value: r.our_value,
  peer_value: r.peer_value,
  peer_source: r.peer_source,
  peer_sample_size: r.peer_sample_size,
  peer_as_of: r.peer_as_of,
  reading: r.reading,
  changed_at: r.changed_at,
});

/** The earlier versions of a benchmark, newest first; null when they could not be read. */
async function benchmarkHistory(env: Env, benchmarkId: number, userId: number) {
  try {
    const rows = await env.DB.prepare(
      `SELECT metric, our_value, peer_value, peer_source, peer_sample_size, peer_as_of, reading, changed_at
         FROM research_benchmark_history
        WHERE benchmark_id = ? AND owner_user_id = ?
        ORDER BY changed_at DESC, id DESC
        LIMIT 200`
    ).bind(benchmarkId, userId).all<HistoryRow>();
    return (rows.results || []).map(historyDto);
  } catch (error) {
    // Unreadable is not "none": the page says Unavailable, never an empty history.
    console.warn('[research] benchmark history unreadable', error);
    return null;
  }
}

interface ConstituentRow {
  id: number; uid: string; benchmark_id: number; owner_user_id: number;
  name: string; value: string | null; as_of: string | null; position: number; created_at: string;
}

const constituentDto = (r: ConstituentRow) => ({
  uid: r.uid, name: r.name, value: r.value, as_of: r.as_of, created_at: r.created_at,
});

/** The caller's benchmark by uid, or null. */
export async function ownedBenchmark(env: Env, userId: number, uid: string): Promise<BenchRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM research_benchmarks WHERE uid = ? AND owner_user_id = ?`
  ).bind(uid, userId).first<BenchRow>();
  return row || null;
}

/** The detail read: the row, its constituents, and what the page says about them. */
export async function benchmarkDetail(c: Context<{ Bindings: Env }>, user: any, row: BenchRow) {
  const env = c.env;
  const userId = Number(user.id);
  const cons = await env.DB.prepare(
    `SELECT * FROM research_benchmark_constituents
      WHERE benchmark_id = ? AND owner_user_id = ?
      ORDER BY position ASC, id ASC`
  ).bind(row.id, userId).all<ConstituentRow>();
  const constituents = (cons.results || []).map(constituentDto);
  const item = { ...benchDto(row), updated_at: row.updated_at };
  if (item.our_from) {
    // The figure stays as copied; the fund's name is shown only while the
    // caller can still open the fund it came from.
    const fund = (await readableFunds(c, user)).find((f) => Number(f.id) === item.our_from!.fund_id);
    item.our_from.fund_name = fund ? fund.name : null;
  }
  const n = item.is_comparison ? Number(row.peer_sample_size) : null;
  return {
    item,
    constituents,
    history: await benchmarkHistory(env, row.id, userId),
    // Only a comparison has a sample to be thin, or a count to disagree with.
    thin: n !== null && n < BENCH_THIN_AT,
    sample_note: n !== null && n < BENCH_THIN_AT
      ? `The smallest peer set behind this comparison is ${n}. A median over a set that size moves with one member and should not be presented as a market rate.`
      : null,
    count_mismatch: n !== null && constituents.length > 0 && constituents.length !== n,
    mismatch_note: n !== null && constituents.length > 0 && constituents.length !== n
      ? `${constituents.length} ${constituents.length === 1 ? 'constituent is' : 'constituents are'} named against a stored sample of ${n}.`
      : null,
  };
}

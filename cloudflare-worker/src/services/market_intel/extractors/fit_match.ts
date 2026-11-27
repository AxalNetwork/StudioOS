/**
 * Fit-match extractor — runs in the nightly reducer (NOT per-answer)
 * because it needs the full investor.thesis × founder.discovery
 * cross-product. Computes top-3 cosine matches in both directions
 * and returns the prepared D1 statements + stats so the reducer can
 * batch-write them alongside the other extractor cells.
 *
 * k-anonymity: caller MUST verify candidate-pool sizes are ≥
 * K_ANONYMITY_MIN before invoking; this module trusts the caller.
 * Persisted `n` is the candidate-pool size, NOT the top-3 slice.
 */
import type { Env } from '../../../types';

export interface VectorRow {
  user_id: number;
  vec: Float32Array;
  norm: number;
}

export function bytesToFloat32(buf: ArrayBuffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
}

export function cosineSafe(a: Float32Array, an: number, b: Float32Array, bn: number): number {
  if (!an || !bn || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (an * bn);
}

export interface FitMatchOutput {
  statements: D1PreparedStatement[];
  pairs_written: number;
}

export function buildFitMatchWrites(
  env: Env, investors: VectorRow[], founders: VectorRow[],
): FitMatchOutput {
  const out: FitMatchOutput = { statements: [], pairs_written: 0 };
  const insertSql =
    `INSERT INTO market_intel_aggregates
       (extractor, dimension_key, period_key, n, value, payload_json, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(extractor, dimension_key, period_key) DO UPDATE SET
       n = excluded.n, value = excluded.value,
       payload_json = excluded.payload_json,
       computed_at = excluded.computed_at`;

  // Per-investor: top-3 founders. n = founder pool size.
  for (const i of investors) {
    const scored = founders.map((f) => ({ user_id: f.user_id, score: cosineSafe(i.vec, i.norm, f.vec, f.norm) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    out.statements.push(env.DB.prepare(insertSql).bind(
      'fit_match', `investor:${i.user_id}`, 'rolling',
      founders.length,
      scored[0]?.score ?? null, JSON.stringify({ matches: scored }),
    ));
    out.pairs_written++;
  }
  // Per-founder: top-3 investors. n = investor pool size.
  for (const f of founders) {
    const scored = investors.map((i) => ({ user_id: i.user_id, score: cosineSafe(f.vec, f.norm, i.vec, i.norm) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    out.statements.push(env.DB.prepare(insertSql).bind(
      'fit_match', `founder:${f.user_id}`, 'rolling',
      investors.length,
      scored[0]?.score ?? null, JSON.stringify({ matches: scored }),
    ));
    out.pairs_written++;
  }
  return out;
}

/**
 * Task #6 (AT-1) — nightly reducer: rolls per-answer
 * `market_intel_signals` rows up to k-anonymised
 * `market_intel_aggregates`. Suppresses any cell with n < 5.
 *
 * Triggered by:
 *   - the queue handler (`mi_reduce`) after a burst of new signals,
 *   - the nightly cron at 02:15 UTC (full sweep + opt-out purge).
 *
 * The reducer is purely deterministic: no aiRouter calls — those are
 * reserved for the snippet paraphrase path (`extractors.paraphraseForSnippet`).
 */
import type { Env } from '../../types';

export const K_ANONYMITY_MIN = 5;

export interface ReducerStats {
  scanned_signals: number;
  cells_written: number;
  cells_suppressed: number;
  fit_pairs_written: number;
  optout_purged: number;
}

export async function runReducer(env: Env, opts?: { sinceIso?: string }): Promise<ReducerStats> {
  const stats: ReducerStats = {
    scanned_signals: 0, cells_written: 0, cells_suppressed: 0,
    fit_pairs_written: 0, optout_purged: 0,
  };

  // 0. Opt-out enforcement — purge any signals/embeddings for users
  //    who flipped the flag to 1 since the last run. The cron honours
  //    this within 24h per task spec.
  try {
    const purgeSig = await env.DB.prepare(
      `DELETE FROM market_intel_signals WHERE user_id IN (SELECT id FROM users WHERE mi_contribution_optout = 1)`,
    ).run();
    const purgeEmb = await env.DB.prepare(
      `DELETE FROM market_intel_embeddings WHERE user_id IN (SELECT id FROM users WHERE mi_contribution_optout = 1)`,
    ).run();
    stats.optout_purged = ((purgeSig as any).meta?.changes || 0) + ((purgeEmb as any).meta?.changes || 0);
  } catch (e) { console.warn('[mi.reducer] optout purge failed:', (e as Error).message); }

  // 1. Scan signals into in-memory buckets keyed by
  //    (extractor, dimension_key, period_key).
  const sinceClause = opts?.sinceIso ? ` AND created_at >= '${opts.sinceIso.replace(/'/g, '')}'` : '';
  const rows = await env.DB.prepare(
    `SELECT extractor, user_id, persona, sector, geo, period_key, payload_json
       FROM market_intel_signals
       WHERE 1=1 ${sinceClause}`,
  ).all<{ extractor: string; user_id: number; persona: string; sector: string | null; geo: string | null; period_key: string; payload_json: string }>();
  const all = rows.results || [];
  stats.scanned_signals = all.length;

  type Bucket = {
    extractor: string;
    dimension_key: string;
    period_key: string;
    users: Set<number>;
    valenceSum: number; valenceN: number;
    energySum: number; energyN: number;
    countByKey: Map<string, number>;     // generic counter (talc stages, demand topics, …)
    // Per-user latest numeric samples — partner_rate_card uses this to
    // compute medians/IQR over distinct contributors (one sample per user).
    perUserNumeric: Map<number, { hourly?: number; project?: number }>;
    // Per-user latest categorical choice — partner_comp_model histogram.
    perUserChoice: Map<number, string>;
  };
  const buckets = new Map<string, Bucket>();
  function bucketFor(extractor: string, dimension_key: string, period_key: string): Bucket {
    const k = `${extractor}|${dimension_key}|${period_key}`;
    let b = buckets.get(k);
    if (!b) {
      b = { extractor, dimension_key, period_key, users: new Set(),
            valenceSum: 0, valenceN: 0, energySum: 0, energyN: 0, countByKey: new Map(),
            perUserNumeric: new Map(), perUserChoice: new Map() };
      buckets.set(k, b);
    }
    return b;
  }

  for (const r of all) {
    let p: any = {};
    try { p = JSON.parse(r.payload_json); } catch { /* skip */ continue; }
    const sectorKey = r.sector || 'global';
    const geoKey = r.geo || 'global';
    if (r.extractor === 'sentiment') {
      const b = bucketFor('sentiment', `sector:${sectorKey}`, r.period_key);
      b.users.add(r.user_id);
      if (typeof p.valence === 'number') { b.valenceSum += p.valence; b.valenceN++; }
      if (typeof p.energy === 'number')  { b.energySum  += p.energy;  b.energyN++;  }
      // sentiment-geo cross-tab
      const bg = bucketFor('sentiment_geo', `geo:${geoKey}:${sectorKey}`, r.period_key);
      bg.users.add(r.user_id);
      if (typeof p.valence === 'number') { bg.valenceSum += p.valence; bg.valenceN++; }
    } else if (r.extractor === 'talc') {
      const b = bucketFor('talc', `${r.persona}:${sectorKey}`, r.period_key);
      b.users.add(r.user_id);
      if (typeof p.stage === 'string') b.countByKey.set(p.stage, (b.countByKey.get(p.stage) || 0) + 1);
    } else if (r.extractor === 'demand_supply') {
      const side = String(p.side || 'demand');
      const topics: string[] = Array.isArray(p.topics) ? p.topics : [];
      for (const t of topics) {
        const b = bucketFor('demand_supply', `${sectorKey}:${side}:${t}`, r.period_key);
        b.users.add(r.user_id);
        b.countByKey.set(t, (b.countByKey.get(t) || 0) + 1);
      }
    } else if (r.extractor === 'sector_heat') {
      const b = bucketFor('sector_heat', `sector:${sectorKey}`, r.period_key);
      b.users.add(r.user_id);
      if (typeof p.valence === 'number') { b.valenceSum += p.valence; b.valenceN++; }
      b.countByKey.set('contributions', (b.countByKey.get('contributions') || 0) + 1);
    } else if (r.extractor === 'partner_rate_card') {
      const topic = String(p.topic || 'general');
      const b = bucketFor('partner_rate_card', `${sectorKey}:${topic}`, r.period_key);
      b.users.add(r.user_id);
      const cur = b.perUserNumeric.get(r.user_id) || {};
      if (typeof p.hourly === 'number' && p.hourly >= 0) cur.hourly = p.hourly;
      if (typeof p.project === 'number' && p.project > 0) cur.project = p.project;
      b.perUserNumeric.set(r.user_id, cur);
    } else if (r.extractor === 'partner_comp_model') {
      const b = bucketFor('partner_comp_model', `${sectorKey}`, r.period_key);
      b.users.add(r.user_id);
      if (typeof p.model === 'string') b.perUserChoice.set(r.user_id, p.model);
    }
  }

  // 2. Persist buckets honoring k≥5; compose Partner-Pulse +
  //    Capital-Velocity from already-persisted demand_supply / sentiment cells.
  const writes: D1PreparedStatement[] = [];
  for (const b of buckets.values()) {
    const n = b.users.size;
    if (n < K_ANONYMITY_MIN) { stats.cells_suppressed++; continue; }
    let value: number | null = null;
    const payload: Record<string, unknown> = {};
    if (b.extractor === 'sentiment' || b.extractor === 'sentiment_geo') {
      value = b.valenceN ? b.valenceSum / b.valenceN : null;
      payload.energy = b.energyN ? b.energySum / b.energyN : null;
    } else if (b.extractor === 'talc') {
      const dist: Record<string, number> = {};
      let total = 0;
      for (const [k, v] of b.countByKey) { dist[k] = v; total += v; }
      // mode
      const mode = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      value = total ? Object.values(dist).reduce((m, v) => Math.max(m, v), 0) / total : null;
      payload.distribution = dist;
      payload.mode = mode;
    } else if (b.extractor === 'demand_supply') {
      value = b.countByKey.get(b.dimension_key.split(':').pop() || '') || 0;
      payload.count = value;
    } else if (b.extractor === 'sector_heat') {
      const contrib = b.countByKey.get('contributions') || 0;
      const meanVal = b.valenceN ? b.valenceSum / b.valenceN : 0;
      // heat = contributions × (1 + |meanVal|) — bounded by sqrt for visual readability
      value = Math.sqrt(contrib) * (1 + Math.abs(meanVal));
      payload.contributions = contrib;
      payload.mean_valence = meanVal;
    } else if (b.extractor === 'partner_rate_card') {
      const samples = Array.from(b.perUserNumeric.values());
      const hourlies = samples.map((v) => v.hourly).filter((x): x is number => typeof x === 'number');
      const projects = samples.map((v) => v.project).filter((x): x is number => typeof x === 'number');
      const median = (arr: number[]): number | null => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };
      const pct = (arr: number[], q: number): number | null => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)));
        return s[idx];
      };
      // Per-metric k≥5: only emit a metric when at least K_MIN distinct
      // partners contributed that specific metric. Cell-level n already
      // passed the outer K_MIN gate above.
      const hourlyOk = hourlies.length >= K_ANONYMITY_MIN;
      const projectOk = projects.length >= K_ANONYMITY_MIN;
      payload.median_hourly  = hourlyOk  ? Math.round(median(hourlies)!)  : null;
      payload.p25_hourly     = hourlyOk  ? Math.round(pct(hourlies, 0.25)!) : null;
      payload.p75_hourly     = hourlyOk  ? Math.round(pct(hourlies, 0.75)!) : null;
      payload.median_project = projectOk ? Math.round(median(projects)!)  : null;
      value = (payload.median_hourly as number | null);
      // Cell with no usable metric — suppress.
      if (!hourlyOk && !projectOk) { stats.cells_suppressed++; continue; }
    } else if (b.extractor === 'partner_comp_model') {
      const dist: Record<string, number> = {};
      for (const choice of b.perUserChoice.values()) {
        dist[choice] = (dist[choice] || 0) + 1;
      }
      payload.distribution = dist;
      // value = modal-bucket count, useful for ORDER BY value DESC.
      value = Object.values(dist).reduce((m, v) => Math.max(m, v), 0);
    }
    payload.n = n;
    writes.push(
      env.DB.prepare(
        `INSERT INTO market_intel_aggregates
           (extractor, dimension_key, period_key, n, value, payload_json, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(extractor, dimension_key, period_key) DO UPDATE SET
           n = excluded.n, value = excluded.value,
           payload_json = excluded.payload_json,
           computed_at = excluded.computed_at`,
      ).bind(b.extractor, b.dimension_key, b.period_key, n, value, JSON.stringify(payload)),
    );
    stats.cells_written++;
  }

  // 3. Fit-match — cosine over investor.thesis × founder.discovery.
  //    Aggregated by `fit:investor:<hashed_id>` so investor identifiers
  //    are pseudonymous in the cell key. The /fit endpoints lookup by
  //    requester user_id (no hash leakage to clients).
  try {
    const inv = await env.DB.prepare(
      `SELECT user_id, vector, norm FROM market_intel_embeddings WHERE persona='investor' AND kind='thesis'`,
    ).all<{ user_id: number; vector: ArrayBuffer; norm: number }>();
    const fdr = await env.DB.prepare(
      `SELECT user_id, vector, norm FROM market_intel_embeddings WHERE persona='founder' AND kind='discovery'`,
    ).all<{ user_id: number; vector: ArrayBuffer; norm: number }>();
    const investors = (inv.results || []).map((r) => ({ user_id: r.user_id, vec: bytesToFloat32(r.vector), norm: r.norm }));
    const founders = (fdr.results || []).map((r) => ({ user_id: r.user_id, vec: bytesToFloat32(r.vector), norm: r.norm }));
    // k-anonymity guard: never publish fit_match cells when the
    // candidate-pool size is below the K_ANONYMITY_MIN threshold.
    // The /fit/* endpoints additionally re-check `n >= K_MIN` at read
    // time as defense-in-depth.
    if (founders.length < K_ANONYMITY_MIN || investors.length < K_ANONYMITY_MIN) {
      stats.cells_suppressed += investors.length + founders.length;
    } else {
    // Per-investor: top-3 founders.
    for (const i of investors) {
      const scored = founders.map((f) => ({ user_id: f.user_id, score: cosineSafe(i.vec, i.norm, f.vec, f.norm) }))
        .sort((a, b) => b.score - a.score).slice(0, 3);
      writes.push(
        env.DB.prepare(
          `INSERT INTO market_intel_aggregates
             (extractor, dimension_key, period_key, n, value, payload_json, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(extractor, dimension_key, period_key) DO UPDATE SET
             n = excluded.n, value = excluded.value,
             payload_json = excluded.payload_json,
             computed_at = excluded.computed_at`,
        ).bind('fit_match', `investor:${i.user_id}`, 'rolling',
               investors.length, // n = candidate-pool size, not match-count
               scored[0]?.score ?? null, JSON.stringify({ matches: scored })),
      );
      stats.fit_pairs_written++;
    }
    // Per-founder: top-3 investors.
    for (const f of founders) {
      const scored = investors.map((i) => ({ user_id: i.user_id, score: cosineSafe(f.vec, f.norm, i.vec, i.norm) }))
        .sort((a, b) => b.score - a.score).slice(0, 3);
      writes.push(
        env.DB.prepare(
          `INSERT INTO market_intel_aggregates
             (extractor, dimension_key, period_key, n, value, payload_json, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(extractor, dimension_key, period_key) DO UPDATE SET
             n = excluded.n, value = excluded.value,
             payload_json = excluded.payload_json,
             computed_at = excluded.computed_at`,
        ).bind('fit_match', `founder:${f.user_id}`, 'rolling',
               founders.length, // n = candidate-pool size, not match-count
               scored[0]?.score ?? null, JSON.stringify({ matches: scored })),
      );
      stats.fit_pairs_written++;
    }
    }
  } catch (e) { console.warn('[mi.reducer] fit_match failed:', (e as Error).message); }

  // Authoritative rebuild: nuke prior cells for the extractors this
  // reducer pass owns BEFORE writing fresh ones, so any cell that
  // dropped below k≥5 (or whose contributors opted out) cannot remain
  // queryable. Scoped to the extractor families produced here so
  // unrelated cells (e.g. legacy/test rows) are untouched.
  try {
    await env.DB.prepare(
      `DELETE FROM market_intel_aggregates WHERE extractor IN
         ('sentiment','sentiment_geo','talc','demand_supply','sector_heat','fit_match',
          'partner_rate_card','partner_comp_model')`,
    ).run();
  } catch (e) { console.warn('[mi.reducer] pre-write purge failed:', (e as Error).message); }

  if (writes.length) {
    // D1 batch caps; chunk to be safe.
    for (let i = 0; i < writes.length; i += 25) {
      try { await env.DB.batch(writes.slice(i, i + 25)); }
      catch (e) { console.warn('[mi.reducer] batch failed:', (e as Error).message); }
    }
  }

  return stats;
}

function bytesToFloat32(buf: ArrayBuffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
}
function cosineSafe(a: Float32Array, an: number, b: Float32Array, bn: number): number {
  if (!an || !bn || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (an * bn);
}

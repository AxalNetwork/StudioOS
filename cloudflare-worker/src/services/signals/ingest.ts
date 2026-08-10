/**
 * Signals — the ingestion layer that PERSISTS live evidence into D1.
 *
 * This is the half of the pipeline the README always described and the code
 * never had: `runRefresh` used to call two adapters, count the results, and
 * throw them away — so the D1-first read path fell back to the seed corpus
 * forever, and every founder saw the same ten illustrative signals with
 * timestamps that recomputed at read time. This module closes that loop.
 *
 * WHAT A REFRESH DOES, per signal thesis:
 *   1. derive search queries from the thesis (niche + tags — the same terms
 *      the card displays, so "Query:" lines in the UI are the literal truth),
 *   2. fan out to every live evidence adapter (free, keyless public APIs —
 *      see adapters.ts) with per-source failure isolation,
 *   3. dedupe (by URL, then normalized title) and keep the freshest,
 *   4. gate on the evidence threshold: a thesis is only PROMOTED to an active,
 *      founder-visible signal when at least MIN_EVIDENCE_KINDS independent
 *      evidence families and MIN_EVIDENCE_ITEMS real records back it —
 *      "we would rather show nothing than infer a trend from thin data",
 *   5. upsert the signal + its REAL evidence + its companies into D1, with
 *      scores recomputed from the real evidence via ranking.ts and
 *      `updated_at` set to the actual refresh time.
 *
 * WHAT IS EDITORIAL vs WHAT IS EVIDENCE — the honest split: the thesis text
 * (title, framing, build angle, advisor note) is curated interpretation from
 * the corpus in seed.ts, and the UI labels it as interpretation. The evidence
 * (titles, URLs, timestamps, counts) is exclusively what the public record
 * returned on THIS refresh. Seed evidence lines never enter D1 — a promoted
 * signal's evidence trail is 100% fetched.
 *
 * Pure helpers (`deriveQueries`, `dedupeEvidence`, `meetsThreshold`) are
 * exported for the fixture-driven test suite.
 */
import type { Env } from '../../types';
import type { EvidenceItem, Signal } from './types';
import { getSeedCompanies, getSeedSignals } from './seed';
import { computeConfidence, computeFreshness } from './ranking';
import { ensureSourcesSeeded } from './sources';
import { EVIDENCE_ADAPTERS, sourceDisabled } from './adapters';

/** Distinct evidence KINDS required before a thesis is founder-visible. */
export const MIN_EVIDENCE_KINDS = 2;
/** Total real evidence records required before a thesis is founder-visible. */
export const MIN_EVIDENCE_ITEMS = 4;

/**
 * The search queries for a thesis. The niche IS the query — it is the most
 * specific human-readable phrase the signal carries, and reusing it verbatim
 * keeps the UI's provenance honest ("Query: SMB credit infrastructure" means
 * exactly that string hit the APIs). Tags widen recall for sparse niches.
 */
export function deriveQueries(s: Pick<Signal, 'niche' | 'sector' | 'tags'>): string[] {
  const out: string[] = [];
  const push = (t: unknown) => {
    const v = String(t ?? '').trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  push(s.niche);
  for (const t of s.tags || []) push(t);
  push(s.sector);
  return out.slice(0, 3);
}

/** Dedupe by URL first (same record found twice), then by normalized title. */
export function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const it of items) {
    const key = (it.url || `t:${it.title}`).trim().toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** The promotion gate — multiple independent families, enough real records. */
export function meetsThreshold(items: EvidenceItem[]): boolean {
  if (items.length < MIN_EVIDENCE_ITEMS) return false;
  return new Set(items.map((i) => i.kind)).size >= MIN_EVIDENCE_KINDS;
}

export type SourceHealth = { source: string; status: 'ok' | 'empty' | 'error' | 'off'; items: number };

export type IngestResult = {
  ok: boolean;
  ran_at: string;
  promoted: number; // theses that met the threshold → status 'active'
  held: number; // theses below threshold → status 'needs_evidence' (hidden)
  evidence_written: number;
  sources: SourceHealth[];
};

/**
 * Fetch evidence for one thesis across all live adapters. Failures and empty
 * results are recorded per source — silence is not success.
 */
async function gatherEvidence(
  env: Env,
  queries: string[],
  sector: string,
  perSource: Map<string, SourceHealth>,
): Promise<EvidenceItem[]> {
  const all: EvidenceItem[] = [];
  for (const adapter of EVIDENCE_ADAPTERS) {
    const key = adapter.source.key;
    const health = perSource.get(key) || { source: key, status: 'empty' as const, items: 0 };
    if (sourceDisabled(env, key)) {
      perSource.set(key, { ...health, status: 'off' });
      continue;
    }
    if (!adapter.fetchEvidence) continue;
    try {
      const items = await adapter.fetchEvidence(env, { terms: queries, sector });
      all.push(...items);
      perSource.set(key, {
        source: key,
        status: items.length || health.items ? 'ok' : health.status === 'error' ? 'error' : 'empty',
        items: health.items + items.length,
      });
    } catch {
      if (health.items === 0) perSource.set(key, { ...health, status: 'error' });
    }
  }
  return all;
}

/** Upsert the slow-moving public-company facts backing the signal cards. */
async function upsertCompanies(env: Env): Promise<void> {
  for (const c of getSeedCompanies()) {
    await env.DB.prepare(
      `INSERT INTO signal_companies
         (symbol, name, exchange, country, region, sector, industry, market_cap,
          market_cap_band, employee_count, employee_band, ceo, description,
          customer_type, maturity_stage, source_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         name = excluded.name, sector = excluded.sector, industry = excluded.industry,
         market_cap = excluded.market_cap, market_cap_band = excluded.market_cap_band,
         employee_count = excluded.employee_count, employee_band = excluded.employee_band,
         description = excluded.description, updated_at = excluded.updated_at`,
    ).bind(
      c.symbol, c.name, c.exchange || null, c.country || null, c.region || null,
      c.sector || null, c.industry || null, c.market_cap ?? null,
      c.market_cap_band || null, c.employee_count ?? null, c.employee_band || null,
      c.ceo || null, c.description || null, c.customer_type || null,
      c.maturity_stage || null, c.source_key || 'seed', // provenance
    ).run();
  }
}

/**
 * Run the full ingestion. Called by POST /api/signals/refresh (admin) and the
 * nightly cron. Idempotent: re-running replaces each signal's evidence with
 * the current state of the public record.
 */
export async function runIngestion(env: Env): Promise<IngestResult> {
  const ranAt = new Date().toISOString();
  await ensureSourcesSeeded(env);
  await upsertCompanies(env);

  const perSource = new Map<string, SourceHealth>();
  let promoted = 0;
  let held = 0;
  let evidenceWritten = 0;

  for (const thesis of getSeedSignals()) {
    const queries = deriveQueries(thesis);
    const fetched = dedupeEvidence(
      await gatherEvidence(env, queries, thesis.sector, perSource),
    );
    const active = meetsThreshold(fetched);

    // Scores are recomputed from the REAL evidence — the stored values are
    // hints for cold reads; ranking.ts recomputes at read time regardless.
    const candidate: Signal = { ...thesis, evidence_items: fetched, updated_at: ranAt };
    const confidence = fetched.length ? computeConfidence(candidate) : 0;
    const freshness = fetched.length ? computeFreshness(candidate) : 0;

    await env.DB.prepare(
      `INSERT INTO signals
         (id, type, title, thesis, why_now, region, country, sector, industry, niche,
          market_cap_band, target_customers, maturity_stage, founder_opportunity,
          advisor_note, build_opportunity, market_context, confidence_score,
          freshness_score, tags, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         confidence_score = excluded.confidence_score,
         freshness_score = excluded.freshness_score,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).bind(
      thesis.id, thesis.type, thesis.title, thesis.thesis, thesis.why_now,
      thesis.region, thesis.country, thesis.sector, thesis.industry || null,
      thesis.niche, thesis.market_cap_band, JSON.stringify(thesis.target_customers || []),
      thesis.maturity_stage || null, thesis.founder_opportunity, thesis.advisor_note,
      JSON.stringify(thesis.build || {}), JSON.stringify(thesis.market || {}),
      confidence, freshness, JSON.stringify(thesis.tags || []),
      active ? 'active' : 'needs_evidence', ranAt,
    ).run();

    // Replace the evidence trail wholesale: what backs a signal is what the
    // public record shows NOW, not an accretion of every past fetch.
    await env.DB.prepare('DELETE FROM signal_evidence WHERE signal_id = ?').bind(thesis.id).run();
    for (const ev of fetched) {
      await env.DB.prepare(
        `INSERT INTO signal_evidence (id, signal_id, kind, title, detail, source_key, url, weight, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), thesis.id, ev.kind, ev.title, ev.detail || null,
        ev.source_key, ev.url || null, ev.weight ?? 0.5, ev.observed_at,
      ).run();
      evidenceWritten++;
    }

    for (const sym of thesis.related_companies || []) {
      await env.DB.prepare(
        `INSERT INTO signal_company_map (signal_id, symbol) VALUES (?, ?)
         ON CONFLICT(signal_id, symbol) DO NOTHING`,
      ).bind(thesis.id, sym).run();
    }

    if (active) promoted++; else held++;
  }

  return {
    ok: true,
    ran_at: ranAt,
    promoted,
    held,
    evidence_written: evidenceWritten,
    sources: [...perSource.values()],
  };
}

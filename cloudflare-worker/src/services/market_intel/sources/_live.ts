/**
 * Shared helpers for LIVE Market-Intelligence connectors (P0 free sources).
 *
 * Every live source asks each provider "how much recent activity is there
 * for this sector?" and normalises the raw count into a 0..1 metric_value
 * on the same scale the stubs use. One row per sector, each carrying a real
 * `citation_url` that points at an actual provider resource.
 *
 * Safety contract: a per-sector fetch that fails is skipped (we never emit a
 * fabricated citation). If EVERY sector fails, `buildLiveRows` throws so the
 * aggregator (`runOneSource`) degrades to the deterministic stub and records
 * the error in the quota tracker. The thrown message preserves provider HTTP
 * status codes (e.g. `http_429`) so the aggregator's rate-limit detection
 * still fires.
 */
import type { CommonRow } from '../registry';
import { row } from './_helpers';

/** Polite, identifiable UA — required by SEC EDGAR, appreciated elsewhere. */
export const UA = 'Axal StudioOS market-intel (+https://axal.vc)';

/** Contact email for provider polite-pool / UA policies. */
export function contactEmail(env: unknown): string {
  const e = env as Record<string, string | undefined>;
  return e.MI_CONTACT_EMAIL || 'market-intel@axal.vc';
}

/** Optional secret accessor without widening the global Env interface. */
export function optEnv(env: unknown, key: string): string | undefined {
  return (env as Record<string, string | undefined>)[key];
}

/**
 * Canonical sector → primary search phrase. Connectors quote / encode this
 * as each provider's query syntax requires. Falls back to the sector name
 * itself for any sector not listed here.
 */
export const SECTOR_QUERY: Record<string, string> = {
  'Agentic B2B': 'AI agents',
  'Bio-Automation': 'synthetic biology',
  'AI Infrastructure': 'AI infrastructure',
  'Fintech / DeFi': 'decentralized finance',
  'Data / Analytics': 'data analytics',
  'Cybersecurity': 'cybersecurity',
  'Autonomous Robotics': 'autonomous robotics',
  'Climate Intelligence': 'climate technology',
  'Quantum Infrastructure': 'quantum computing',
  'Enterprise AI': 'enterprise AI',
  'Vertical SaaS': 'vertical SaaS',
  'DevTools': 'developer tools',
};

export function queryFor(sector: string): string {
  return SECTOR_QUERY[sector] || sector;
}

/**
 * Smooth, absolute count → 0..1 with `value = count / (count + half)`.
 * `half` is the count that maps to ~0.5. Clamped to the stub's 0.05..0.95
 * band so live and stub rows stay comparable in the composite.
 */
export function saturate(count: number, half: number): number {
  if (!isFinite(count) || count <= 0) return 0.05;
  const v = count / (count + Math.max(1, half));
  return Math.max(0.05, Math.min(0.95, v));
}

/** YYYY-MM-DD `days` ago (UTC). */
export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Unix-seconds `days` ago. */
export function daysAgoUnix(days: number): number {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

/** fetch + JSON with a hard timeout; throws `http_<status>` on non-2xx. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface PerSectorResult {
  /** Normalised 0..1 metric. */
  value: number;
  /** Raw provider count, persisted as `raw_value` for transparency. */
  raw: number;
  /** Real provider resource URL. */
  citation_url: string;
}

/**
 * Loop sectors, call `perSector`, and assemble normalised rows. A sector
 * that returns `null` (no real resource to cite) or throws is skipped.
 * Throws when nothing resolved so the caller degrades to the stub.
 */
export async function buildLiveRows(opts: {
  sectors: string[];
  key: string;
  metric_key: string;
  now?: Date;
  perSector: (sector: string, query: string) => Promise<PerSectorResult | null>;
}): Promise<CommonRow[]> {
  const ts = (opts.now ?? new Date()).toISOString();
  const rows: CommonRow[] = [];
  const errors: string[] = [];
  for (const sector of opts.sectors) {
    try {
      const r = await opts.perSector(sector, queryFor(sector));
      if (!r) continue;
      rows.push(
        row({
          source_key: opts.key,
          sector,
          metric_key: opts.metric_key,
          metric_value: r.value,
          raw_value: r.raw,
          unit: 'count',
          ts,
          citation_url: r.citation_url,
        }),
      );
    } catch (e) {
      errors.push(`${sector}:${(e as Error)?.message || 'err'}`);
    }
  }
  if (rows.length === 0) {
    throw new Error(`live_fetch_failed ${errors.slice(0, 4).join(',')}`);
  }
  return rows;
}

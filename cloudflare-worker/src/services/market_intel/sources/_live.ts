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
 *
 * D7707 — a row says what it measures. `ts` stays the fetch time (the scorer
 * reads it, and #7707 changes no index value), and beside it each row now
 * carries `retrieved_at` (the same fetch time), the provider's period
 * (`observed_period`, `observed_period_end`), its last-updated date
 * (`published_at`, never the fetch time) and whether it is a per-sector
 * signal (`scope = 'sector'`, `buildLiveRows`) or macro context replicated
 * across sectors (`scope = 'context'`, `buildUniformRows`, with its
 * `coverage_area`). A period the response does not state stays null.
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

/** fetch + text with a hard timeout; throws `http_<status>` on non-2xx.
 * Used by providers that speak XML/Atom (e.g. arXiv) rather than JSON. */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Clamp an already-0..1-ish value into the stub's 0.05..0.95 band so live
 * and stub rows stay comparable in the composite. Non-finite → floor. */
export function clamp01(v: number): number {
  if (!isFinite(v)) return 0.05;
  return Math.max(0.05, Math.min(0.95, v));
}

export interface PerSectorResult {
  /** Normalised 0..1 metric. */
  value: number;
  /** Raw provider count, persisted as `raw_value` for transparency. */
  raw: number;
  /** Real provider resource URL. */
  citation_url: string;
  /** D7707 — the period measured, in the format `normalisePeriod` returns; null when unreadable. */
  observed_period?: string | null;
  /** D7707 — the last day of that period, `YYYY-MM-DD`. */
  observed_period_end?: string | null;
  /** D7707 — the provider's own last-updated date; null when it sends none. */
  published_at?: string | null;
  /** D7707 — what the figure is: the series code, its name, the fixed divisor. Stored as `payload_json`. */
  payload?: unknown;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Last day of `year`-`month` (month 1..12), `YYYY-MM-DD`. */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * D7707 — a provider's period label in the stored format, with its last day.
 *
 *   '2025'                    → { '2025',     '2025-12-31' }
 *   '2025-Q3', '2025Q3'       → { '2025-Q3',  '2025-09-30' }
 *   '2025-07', '2025M07'      → { '2025-07',  '2025-07-31' }
 *   '2025-07-04'              → { '2025-07-04/2025-07-04', '2025-07-04' }
 *
 * Anything else is null: a period that cannot be read is not guessed.
 */
export function normalisePeriod(raw: unknown): { observed_period: string; observed_period_end: string } | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  let m = /^(\d{4})$/.exec(s);
  if (m) return { observed_period: m[1], observed_period_end: `${m[1]}-12-31` };
  m = /^(\d{4})-?Q([1-4])$/i.exec(s);
  if (m) {
    const q = Number(m[2]);
    return { observed_period: `${m[1]}-Q${q}`, observed_period_end: lastDayOfMonth(Number(m[1]), q * 3) };
  }
  m = /^(\d{4})(?:-|M)(\d{2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return { observed_period: `${m[1]}-${m[2]}`, observed_period_end: lastDayOfMonth(Number(m[1]), Number(m[2])) };
  }
  if (ISO_DAY.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`))) {
    return { observed_period: `${s}/${s}`, observed_period_end: s };
  }
  return null;
}

/**
 * D7707 — the window a count was queried over, to the day:
 * `YYYY-MM-DD/YYYY-MM-DD`, ending on its last day.
 */
export function windowPeriod(from: string, to: string): { observed_period: string; observed_period_end: string } | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return null;
  return { observed_period: `${from}/${to}`, observed_period_end: to };
}

/**
 * D7707 — a provider's last-updated stamp as stored: a bare date stays
 * `YYYY-MM-DD`, a date-time becomes its UTC ISO form. Unreadable is null.
 */
export function publishedDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (ISO_DAY.test(s)) return isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
  // `+0100` → `+01:00`, the form every runtime parses.
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return isNaN(t) ? null : new Date(t).toISOString();
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
  // ts is the fetch time, as before D7707; retrieved_at says so in its own column.
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
          retrieved_at: ts,
          scope: 'sector',
          observed_period: r.observed_period ?? null,
          observed_period_end: r.observed_period_end ?? null,
          published_at: r.published_at ?? null,
          ...(r.payload !== undefined ? { payload: r.payload } : {}),
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

/**
 * Macro-backdrop builder for single-series providers (World Bank, OECD,
 * Eurostat, BLS, FRED). These expose ONE national/global figure rather than
 * a per-sector signal, so we fetch it once and replicate the same normalised
 * value across every sector — an honest macro context that shifts the whole
 * composite uniformly. Throws when `fetchOne` yields null so the caller
 * degrades to the deterministic stub (same contract as `buildLiveRows`).
 *
 * D7707 — the rows are tagged `scope = 'context'` with the area the figure
 * covers (`coverage_area`), and carry the provider's period and publication
 * date when `fetchOne` reads them.
 */
export async function buildUniformRows(opts: {
  sectors: string[];
  key: string;
  metric_key: string;
  now?: Date;
  unit?: CommonRow['unit'];
  /** D7707 — the area the single figure covers ('World', 'OECD aggregate', 'EU27'). */
  coverage_area?: string;
  fetchOne: () => Promise<PerSectorResult | null>;
}): Promise<CommonRow[]> {
  const r = await opts.fetchOne();
  if (!r) throw new Error('live_fetch_failed empty');
  const ts = (opts.now ?? new Date()).toISOString();
  return opts.sectors.map((sector) =>
    row({
      source_key: opts.key,
      sector,
      metric_key: opts.metric_key,
      metric_value: r.value,
      raw_value: r.raw,
      unit: opts.unit ?? 'index',
      ts,
      citation_url: r.citation_url,
      retrieved_at: ts,
      scope: 'context',
      coverage_area: opts.coverage_area ?? null,
      observed_period: r.observed_period ?? null,
      observed_period_end: r.observed_period_end ?? null,
      published_at: r.published_at ?? null,
      ...(r.payload !== undefined ? { payload: r.payload } : {}),
    }),
  );
}

/**
 * Signals — source registry + swappable data adapters.
 *
 * DESIGN GOAL: never hardcode one vendor. Each data family (fundamentals,
 * market, news, filings, registry, hiring) is fronted by a `SourceAdapter`
 * with a stable interface. The signal engine consumes the ADAPTER, never a
 * vendor SDK — so swapping a free source for a premium one later is a change
 * to ONE adapter file, not to the ranking engine, the route, or the UI.
 *
 * All default adapters use ONLY free / free-tier / public endpoints. Every
 * place where a paid provider would slot in is marked with `TODO(premium)`.
 *
 * Confidence inputs live on the SignalSource: `quality_weight` (how much we
 * trust the source's factual accuracy) and `freshness_halflife_days` (how fast
 * its data decays). The ranking engine reads these — see ./ranking.ts.
 */
import type { Env } from '../../types';
import type {
  SignalSource,
  NormalizedCompany,
  EvidenceItem,
  MarketCapBand,
  EmployeeBand,
  MaturityStage,
} from './types';

// ---------------------------------------------------------------------------
// Source registry — the canonical list of adapters. Persisted into
// `signal_sources` by ensureSourcesSeeded(), but this in-code copy is the
// source of truth so confidence scoring works even before the table is filled.
// ---------------------------------------------------------------------------
export const SOURCE_REGISTRY: SignalSource[] = [
  {
    key: 'sec_edgar',
    name: 'SEC EDGAR (full-text filings)',
    kind: 'filing',
    tier: 'free',
    quality_weight: 0.95, // primary-source regulatory filings — highest trust
    freshness_halflife_days: 120, // filings are quarterly/annual, decay slowly
    homepage: 'https://www.sec.gov/edgar',
    enabled: true,
    notes: 'Primary-source 10-K/10-Q/8-K/20-F language. Free, rate-limited.',
  },
  {
    key: 'company_profile',
    name: 'Public company profile / fundamentals',
    kind: 'fundamentals',
    tier: 'free_tier',
    quality_weight: 0.8,
    freshness_halflife_days: 45,
    homepage: 'https://site.financialmodelingprep.com/developer/docs',
    enabled: true,
    // TODO(premium): swap the free-tier FMP/Finnhub profile call for a paid
    // fundamentals feed (FMP paid, Refinitiv, S&P Capital IQ) — same
    // NormalizedCompany output, higher rate limits + more fields.
    notes: 'Sector, market cap, headcount, CEO, description. Free tier is rate-limited.',
  },
  {
    key: 'market_context',
    name: 'Global market data (trend direction only)',
    kind: 'market_data',
    tier: 'free',
    quality_weight: 0.55, // used ONLY for trend direction context, never as lead
    freshness_halflife_days: 7,
    homepage: 'https://query1.finance.yahoo.com',
    enabled: true,
    notes: 'Reused from services/market-data.ts. Context only — no candlesticks in the UI.',
  },
  {
    key: 'news_rss',
    name: 'News & sentiment (RSS aggregate)',
    kind: 'news',
    tier: 'free',
    quality_weight: 0.5, // headlines are noisy → deliberately low weight
    freshness_halflife_days: 14,
    homepage: 'https://news.google.com',
    enabled: true,
    // TODO(premium): swap for a licensed news/sentiment API (NewsAPI paid,
    // Bloomberg, Diffbot) to get entity-tagged, de-duplicated, scored articles.
    notes: 'Free RSS. Low quality weight so noisy headlines cannot dominate ranking.',
  },
  {
    key: 'registry_opencorporates',
    name: 'Public corporate registry',
    kind: 'registry',
    tier: 'free_tier',
    quality_weight: 0.7,
    freshness_halflife_days: 180,
    homepage: 'https://opencorporates.com',
    enabled: true,
    // TODO(premium): OpenCorporates API key / paid tier for bulk entity lookups
    // and officer data used for country-level context.
    notes: 'Country-level incorporation context. Free tier is heavily rate-limited.',
  },
  {
    key: 'hiring_signal',
    name: 'Public hiring / job-posting velocity',
    kind: 'hiring',
    tier: 'free',
    quality_weight: 0.45,
    freshness_halflife_days: 21,
    homepage: 'https://news.ycombinator.com/submitted?id=whoishiring',
    enabled: true,
    // TODO(premium): LinkedIn Talent Insights / Revelio Labs for headcount &
    // role-mix deltas — a strong workflow-digitization demand proxy.
    notes: 'Hiring mentions in HN "Who is hiring?" threads (Algolia API, keyless). Coarse demand proxy; low weight.',
  },
  {
    key: 'federal_register',
    name: 'Federal Register (US rulemaking)',
    kind: 'filing',
    tier: 'free',
    quality_weight: 0.9, // primary-source regulatory text — near-EDGAR trust
    freshness_halflife_days: 120,
    homepage: 'https://www.federalregister.gov/developers/documentation/api/v1',
    enabled: true,
    notes: 'Official US rulemaking documents via the free, keyless Federal Register API.',
  },
  {
    key: 'hn_discussion',
    name: 'Hacker News discussion',
    kind: 'discussion',
    tier: 'free',
    quality_weight: 0.5, // language convergence, never sufficient alone
    freshness_halflife_days: 14,
    homepage: 'https://hn.algolia.com/api',
    enabled: true,
    notes: 'Practitioner threads via the free, keyless Algolia HN Search API. Deduplicated; point-thresholded.',
  },
  {
    key: 'stackexchange_questions',
    name: 'Stack Exchange question activity',
    kind: 'discussion',
    tier: 'free',
    quality_weight: 0.55, // real practitioner friction, tag-scoped
    freshness_halflife_days: 30,
    homepage: 'https://api.stackexchange.com/docs',
    enabled: true,
    notes: 'Question volume + accepted-answer gaps via the keyless Stack Exchange API (300 req/day/IP quota).',
  },
  {
    key: 'github_activity',
    name: 'GitHub repository activity',
    kind: 'developer',
    tier: 'free',
    quality_weight: 0.6, // behavioural, weighted on recency of pushes not stars
    freshness_halflife_days: 45,
    homepage: 'https://docs.github.com/en/rest/search',
    enabled: true,
    notes: 'Repository search via the keyless GitHub REST API (10 searches/min unauthenticated). Ranked by recent pushes, never stars.',
  },
];

const SOURCE_BY_KEY: Record<string, SignalSource> = Object.fromEntries(
  SOURCE_REGISTRY.map((s) => [s.key, s]),
);

export function getSource(key: string): SignalSource | undefined {
  return SOURCE_BY_KEY[key];
}

/** Trust weight for a source key; unknown sources get a conservative 0.4. */
export function sourceQuality(key: string): number {
  return SOURCE_BY_KEY[key]?.quality_weight ?? 0.4;
}

/** Freshness half-life (days) for a source key; unknown → 30. */
export function sourceHalflife(key: string): number {
  return SOURCE_BY_KEY[key]?.freshness_halflife_days ?? 30;
}

// ---------------------------------------------------------------------------
// Normalization helpers — shared so every adapter emits the SAME bands.
// ---------------------------------------------------------------------------
export function capBand(marketCapUsd?: number | null): MarketCapBand | undefined {
  if (marketCapUsd == null || !isFinite(marketCapUsd)) return undefined;
  const b = marketCapUsd;
  if (b < 50e6) return 'nano';
  if (b < 300e6) return 'micro';
  if (b < 2e9) return 'small';
  if (b < 10e9) return 'mid';
  if (b < 200e9) return 'large';
  return 'mega';
}

export function employeeBand(count?: number | null): EmployeeBand | undefined {
  if (count == null || !isFinite(count)) return undefined;
  if (count <= 50) return '1-50';
  if (count <= 200) return '51-200';
  if (count <= 1000) return '201-1k';
  if (count <= 5000) return '1k-5k';
  if (count <= 20000) return '5k-20k';
  return '20k+';
}

/** Derive a maturity stage from cap + headcount when a provider doesn't give
 *  one. Heuristic, transparent, and free — no paid rating involved. */
export function maturityFrom(
  band?: MarketCapBand,
  emp?: EmployeeBand,
): MaturityStage {
  if (band === 'nano' || band === 'micro') return 'emerging';
  if (band === 'small') return emp === '1-50' || emp === '51-200' ? 'emerging' : 'scaling';
  if (band === 'mid') return 'scaling';
  if (band === 'large') return 'established';
  return 'incumbent';
}

// ---------------------------------------------------------------------------
// Adapter interface. Every source implements the slice(s) it can serve; the
// engine calls whichever adapters are enabled and merges the results.
// ---------------------------------------------------------------------------
export interface SourceAdapter {
  readonly source: SignalSource;
  /** Fetch + normalize company profiles for the given symbols. */
  fetchCompanies?(env: Env, symbols: string[]): Promise<NormalizedCompany[]>;
  /** Fetch recent evidence items for a topic. `terms` are the signal-derived
   *  search queries (see ingest.ts); `symbol`/`sector` remain for the older
   *  company-scoped adapters. */
  fetchEvidence?(env: Env, query: { terms?: string[]; symbol?: string; sector?: string }): Promise<EvidenceItem[]>;
}

const CACHE_TTL = 30 * 60; // 30 min — matches services/market-data.ts posture
const FETCH_TIMEOUT = 4000;
const UA = 'Mozilla/5.0 (compatible; AxalStudioOS/1.0; +https://axal.vc)';

export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init?.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

export async function readCache<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.RATE_LIMITS.get(`signals:src:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(env: Env, key: string, value: unknown): Promise<void> {
  try {
    await env.RATE_LIMITS.put(`signals:src:${key}`, JSON.stringify(value), { expirationTtl: CACHE_TTL });
  } catch {
    /* cache is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Company-profile adapter (free tier). Uses Yahoo's public quoteSummary as a
// zero-key stand-in for a fundamentals provider so the pipeline is exercisable
// without any secret. It normalizes into NormalizedCompany.
// ---------------------------------------------------------------------------
export const companyProfileAdapter: SourceAdapter = {
  source: SOURCE_BY_KEY['company_profile'],
  async fetchCompanies(env: Env, symbols: string[]): Promise<NormalizedCompany[]> {
    const out: NormalizedCompany[] = [];
    for (const symbol of symbols.slice(0, 25)) {
      const cached = await readCache<NormalizedCompany>(env, `profile:${symbol}`);
      if (cached) { out.push(cached); continue; }
      try {
        // TODO(premium): replace this public endpoint with a keyed fundamentals
        // provider. Keep the mapping below so the NormalizedCompany contract holds.
        const r = await fetchWithTimeout(
          `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile,price,summaryDetail`,
        );
        if (!r.ok) continue;
        const j: any = await r.json();
        const res = j?.quoteSummary?.result?.[0];
        if (!res) continue;
        const profile = res.assetProfile || {};
        const price = res.price || {};
        const mktCap = price?.marketCap?.raw as number | undefined;
        const band = capBand(mktCap);
        const empCount = profile?.fullTimeEmployees as number | undefined;
        const empBand = employeeBand(empCount);
        const co: NormalizedCompany = {
          symbol,
          name: price?.longName || price?.shortName || symbol,
          exchange: price?.exchangeName,
          country: profile?.country,
          sector: profile?.sector,
          industry: profile?.industry,
          market_cap: mktCap,
          market_cap_band: band,
          employee_count: empCount,
          employee_band: empBand,
          ceo: (profile?.companyOfficers || []).find((o: any) => /chief exec|CEO/i.test(o?.title || ''))?.name,
          description: profile?.longBusinessSummary,
          maturity_stage: maturityFrom(band, empBand),
          source_key: 'company_profile',
          updated_at: new Date().toISOString(),
        };
        await writeCache(env, `profile:${symbol}`, co);
        out.push(co);
      } catch {
        /* skip this symbol on any adapter error — never fail the whole batch */
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// News adapter (free RSS). Deliberately low quality_weight so a burst of
// headlines cannot, on its own, float a signal to the top — cross-source
// agreement is what the ranker rewards. Returns evidence, not raw articles.
// ---------------------------------------------------------------------------
export const newsAdapter: SourceAdapter = {
  source: SOURCE_BY_KEY['news_rss'],
  async fetchEvidence(env: Env, query: { symbol?: string; sector?: string }): Promise<EvidenceItem[]> {
    const q = (query.symbol || query.sector || '').trim();
    if (!q) return [];
    const cacheKey = `news:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!r.ok) return [];
      const xml = await r.text();
      const items = parseRssTitles(xml, 5).map((it): EvidenceItem => ({
        kind: 'news',
        title: it.title,
        detail: it.source || undefined,
        source_key: 'news_rss',
        url: it.link || undefined,
        weight: sourceQuality('news_rss'),
        observed_at: it.published || new Date().toISOString(),
      }));
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// Minimal RSS title/link/date extraction (mirrors services/market-data.ts,
// intentionally not sharing the private helpers there to keep this module
// self-contained). Strips tags before decoding entities so a crafted payload
// cannot re-enter the tag space (same CodeQL posture as market-data.ts).
function stripAndDecode(s: string): string {
  let out = s;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');
  }
  return out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .trim();
}

function parseRssTitles(xml: string, limit: number): Array<{ title: string; link: string; source: string; published: string | null }> {
  const out: Array<{ title: string; link: string; source: string; published: string | null }> = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = itemRe.exec(xml)) && count < limit) {
    const block = m[0];
    const title = stripAndDecode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1] || '');
    const link = stripAndDecode((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [, ''])[1] || '');
    const src = stripAndDecode((block.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [, ''])[1] || '');
    const pub = stripAndDecode((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [, ''])[1] || '');
    if (!title) continue;
    out.push({
      title: title.slice(0, 180),
      link,
      source: src,
      published: pub ? new Date(pub).toISOString() : null,
    });
    count++;
  }
  return out;
}

/** Adapters the engine will call during a live refresh. Order is irrelevant;
 *  the engine dedupes + merges. */
export const LIVE_ADAPTERS: SourceAdapter[] = [companyProfileAdapter, newsAdapter];

/** Upsert the in-code registry into `signal_sources` (idempotent). Called by
 *  the refresh job so the DB copy stays in sync with the code. Best-effort:
 *  a missing table (migration not applied) is swallowed. */
export async function ensureSourcesSeeded(env: Env): Promise<void> {
  try {
    for (const s of SOURCE_REGISTRY) {
      await env.DB.prepare(
        `INSERT INTO signal_sources (key, name, kind, tier, quality_weight, freshness_halflife_days, homepage, enabled, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           name = excluded.name, kind = excluded.kind, tier = excluded.tier,
           quality_weight = excluded.quality_weight,
           freshness_halflife_days = excluded.freshness_halflife_days,
           homepage = excluded.homepage, enabled = excluded.enabled,
           notes = excluded.notes, updated_at = excluded.updated_at`,
      )
        .bind(
          s.key, s.name, s.kind, s.tier, s.quality_weight,
          s.freshness_halflife_days, s.homepage || null, s.enabled ? 1 : 0, s.notes || null,
        )
        .run();
    }
  } catch {
    /* table may not exist yet in this environment — non-fatal */
  }
}

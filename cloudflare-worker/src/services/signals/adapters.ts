/**
 * Signals — live evidence adapters over free, keyless public APIs.
 *
 * Every adapter here polls a source that requires NO key, NO subscription and
 * NO scraping — documented JSON/REST APIs with published fair-use terms:
 *
 *   hn_discussion            Algolia HN Search API      (hn.algolia.com/api)
 *   hiring_signal            same API, scoped to the monthly "Ask HN: Who is
 *                            hiring?" threads — a real hiring-demand proxy
 *   stackexchange_questions  Stack Exchange API 2.3     (300 req/day keyless)
 *   github_activity          GitHub REST search         (10 searches/min keyless)
 *   federal_register         Federal Register API v1    (keyless, generous)
 *   sec_edgar                EDGAR full-text search     (keyless; UA required
 *                            by SEC fair-access policy)
 *
 * Sources evaluated and REJECTED for the MVP (kept out on purpose):
 *   Google Trends      no official API; scraping violates ToS. The design's
 *                      "proxy" slot stays empty rather than faked.
 *   Reddit             public JSON endpoints reject unauthenticated datacenter
 *                      clients (403); needs an OAuth app → v2.
 *   Product Hunt       GraphQL API requires a token → v2.
 *   LinkedIn / Indeed  ToS prohibit automated access entirely.
 *   App-store ranks    no free API; third-party mirrors have unclear licenses.
 *   Kaggle datasets    static snapshots — cannot honestly claim freshness.
 *   arXiv / PubMed     free and legal, but the current signal corpus is
 *                      commercial-software-heavy; wire when a deeptech/bio
 *                      signal actually needs them → v2.
 *
 * STRUCTURE: each adapter is a thin `fetch → parse` pair. The parse half is a
 * PURE exported function (JSON in, EvidenceItem[] out) so the test suite can
 * pin the mapping against fixture payloads without any network. The fetch half
 * goes through `fetchWithTimeout` (4s cap), caches in KV for 30 min, and
 * returns [] on ANY failure — a dead source degrades coverage honestly instead
 * of failing the refresh or inventing items.
 *
 * Operational kill-switch: set the env var SIGNALS_SOURCES_OFF to a
 * comma-separated list of source keys (e.g. "github_activity,hn_discussion")
 * to skip adapters without a deploy.
 *
 * Every EvidenceItem this module emits carries the REAL public URL of the
 * underlying record and the REAL timestamp the source reports (`observed_at`).
 * Nothing here synthesizes titles, dates or counts.
 */
import type { Env } from '../../types';
import type { EvidenceItem } from './types';
import {
  getSource,
  sourceQuality,
  fetchWithTimeout,
  readCache,
  writeCache,
  type SourceAdapter,
} from './sources';

/** Per-source item cap per query — evidence lists stay scannable. */
const MAX_ITEMS = 5;

/** Minimum HN points before a story counts as evidence — filters drive-by posts. */
const HN_MIN_POINTS = 5;

export type EvidenceQuery = { terms?: string[]; symbol?: string; sector?: string };

function primaryTerm(q: EvidenceQuery): string {
  return (q.terms?.[0] || q.sector || q.symbol || '').trim();
}

function iso(input: string | number | null | undefined): string | null {
  if (input == null) return null;
  const ms = typeof input === 'number'
    ? (input > 1e12 ? input : input * 1000) // epoch seconds vs ms
    : Date.parse(input);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** True when the operator disabled this source via SIGNALS_SOURCES_OFF. */
export function sourceDisabled(env: Env, key: string): boolean {
  const raw = String((env as any).SIGNALS_SOURCES_OFF || '');
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(key);
}

// ---------------------------------------------------------------------------
// Hacker News discussion — Algolia HN Search API (keyless, documented).
// https://hn.algolia.com/api
// ---------------------------------------------------------------------------

export function parseAlgoliaStories(json: unknown): EvidenceItem[] {
  const hits = Array.isArray((json as any)?.hits) ? (json as any).hits : [];
  const out: EvidenceItem[] = [];
  for (const h of hits) {
    const title = String(h?.title || '').trim();
    const when = iso(h?.created_at) || iso(h?.created_at_i);
    const points = Number(h?.points || 0);
    if (!title || !when || points < HN_MIN_POINTS) continue;
    out.push({
      kind: 'discussion',
      title: title.slice(0, 180),
      detail: `${points} points · ${Number(h?.num_comments || 0)} comments on Hacker News`,
      source_key: 'hn_discussion',
      url: h?.url || `https://news.ycombinator.com/item?id=${h?.objectID}`,
      weight: sourceQuality('hn_discussion'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const hnDiscussionAdapter: SourceAdapter = {
  source: getSource('hn_discussion')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `hn:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=12`;
      const r = await fetchWithTimeout(url);
      if (!r.ok) return [];
      const items = parseAlgoliaStories(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Hiring mentions — the SAME Algolia API, restricted to comments whose parent
// story is a monthly "Ask HN: Who is hiring?" thread. A real, free, public
// hiring-demand proxy: each hit is an actual job post naming the workflow.
// ---------------------------------------------------------------------------

const WHO_IS_HIRING_RE = /who is hiring/i;

export function parseAlgoliaHiringComments(json: unknown): EvidenceItem[] {
  const hits = Array.isArray((json as any)?.hits) ? (json as any).hits : [];
  const out: EvidenceItem[] = [];
  for (const h of hits) {
    if (!WHO_IS_HIRING_RE.test(String(h?.story_title || ''))) continue;
    const when = iso(h?.created_at) || iso(h?.created_at_i);
    // Comment bodies are HTML; strip tags/entities down to a plain excerpt.
    const text = String(h?.comment_text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!when || text.length < 40) continue;
    out.push({
      kind: 'hiring',
      title: `Hiring post: ${text.slice(0, 140)}…`,
      detail: `From "${String(h.story_title).slice(0, 60)}" on Hacker News`,
      source_key: 'hiring_signal',
      url: `https://news.ycombinator.com/item?id=${h?.objectID}`,
      weight: sourceQuality('hiring_signal'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const hiringAdapter: SourceAdapter = {
  source: getSource('hiring_signal')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `hiring:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&hitsPerPage=30`;
      const r = await fetchWithTimeout(url);
      if (!r.ok) return [];
      const items = parseAlgoliaHiringComments(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Stack Exchange question activity — API 2.3, keyless (300 req/day/IP).
// https://api.stackexchange.com/docs/advanced-search
// ---------------------------------------------------------------------------

export function parseStackExchangeQuestions(json: unknown): EvidenceItem[] {
  const items = Array.isArray((json as any)?.items) ? (json as any).items : [];
  const out: EvidenceItem[] = [];
  for (const it of items) {
    const title = String(it?.title || '')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .trim();
    const when = iso(it?.creation_date);
    if (!title || !when) continue;
    const answered = it?.is_answered === true;
    out.push({
      kind: 'discussion',
      title: title.slice(0, 180),
      // The accepted-answer gap is the friction signal: a busy question with
      // no accepted answer means the workaround is still the answer.
      detail: `score ${Number(it?.score || 0)} · ${Number(it?.answer_count || 0)} answers${answered ? '' : ' · no accepted answer'} · Stack Overflow`,
      source_key: 'stackexchange_questions',
      url: it?.link || undefined,
      weight: sourceQuality('stackexchange_questions'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const stackExchangeAdapter: SourceAdapter = {
  source: getSource('stackexchange_questions')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `se:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=activity&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=10&filter=default`;
      // The SE API always gzips; Workers' fetch decompresses transparently.
      const r = await fetchWithTimeout(url);
      if (!r.ok) return [];
      const items = parseStackExchangeQuestions(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// GitHub repository activity — REST search, keyless (10 searches/min). Sorted
// by recent pushes; stars are deliberately NOT surfaced (vanity metric).
// Optional GITHUB_TOKEN env raises the rate limit; never required.
// ---------------------------------------------------------------------------

export function parseGithubRepoSearch(json: unknown): EvidenceItem[] {
  const items = Array.isArray((json as any)?.items) ? (json as any).items : [];
  const out: EvidenceItem[] = [];
  for (const repo of items) {
    const name = String(repo?.full_name || '').trim();
    const when = iso(repo?.pushed_at) || iso(repo?.updated_at);
    if (!name || !when) continue;
    const desc = String(repo?.description || '').trim();
    out.push({
      kind: 'developer',
      title: desc ? `${name} — ${desc.slice(0, 120)}` : name,
      detail: `active repository · ${Number(repo?.open_issues_count || 0)} open issues · last push ${when.slice(0, 10)}`,
      source_key: 'github_activity',
      url: repo?.html_url || undefined,
      weight: sourceQuality('github_activity'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const githubAdapter: SourceAdapter = {
  source: getSource('github_activity')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `gh:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      const token = (env as any).GITHUB_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} in:name,description,readme`)}&sort=updated&order=desc&per_page=10`;
      const r = await fetchWithTimeout(url, { headers });
      if (!r.ok) return []; // 403 = shared unauthenticated quota exhausted — degrade, don't invent
      const items = parseGithubRepoSearch(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Federal Register — official US rulemaking, keyless documented API.
// https://www.federalregister.gov/developers/documentation/api/v1
// ---------------------------------------------------------------------------

export function parseFederalRegisterDocs(json: unknown): EvidenceItem[] {
  const results = Array.isArray((json as any)?.results) ? (json as any).results : [];
  const out: EvidenceItem[] = [];
  for (const d of results) {
    const title = String(d?.title || '').trim();
    const when = iso(d?.publication_date);
    if (!title || !when) continue;
    const agencies = Array.isArray(d?.agencies)
      ? d.agencies.map((a: any) => a?.name).filter(Boolean).slice(0, 2).join(', ')
      : '';
    out.push({
      kind: 'filing',
      title: title.slice(0, 180),
      detail: [d?.type, agencies].filter(Boolean).join(' · ') || 'Federal Register document',
      source_key: 'federal_register',
      url: d?.html_url || undefined,
      weight: sourceQuality('federal_register'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const federalRegisterAdapter: SourceAdapter = {
  source: getSource('federal_register')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `fr:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://www.federalregister.gov/api/v1/documents.json?per_page=10&order=newest&conditions%5Bterm%5D=${encodeURIComponent(q)}`;
      const r = await fetchWithTimeout(url);
      if (!r.ok) return [];
      const items = parseFederalRegisterDocs(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// SEC EDGAR full-text search — keyless; SEC's fair-access policy requires a
// descriptive User-Agent, which fetchWithTimeout already sends.
// https://efts.sec.gov/LATEST/search-index?q=...
// ---------------------------------------------------------------------------

export function parseEdgarFullText(json: unknown): EvidenceItem[] {
  const hits = Array.isArray((json as any)?.hits?.hits) ? (json as any).hits.hits : [];
  const out: EvidenceItem[] = [];
  for (const h of hits) {
    const src = h?._source || {};
    const name = Array.isArray(src?.display_names) ? String(src.display_names[0] || '') : '';
    const when = iso(src?.file_date);
    if (!name || !when) continue;
    const form = String(src?.file_type || src?.root_form || 'filing');
    out.push({
      kind: 'filing',
      title: `${name.replace(/\s*\(CIK[^)]*\)\s*/g, '').trim()} — ${form}`,
      detail: `SEC EDGAR ${form} filed ${when.slice(0, 10)}`,
      source_key: 'sec_edgar',
      // Deep Archive links need CIK+accession parsing; the FTS UI permalink is
      // stable and lands the reader on the exact same result set.
      url: `https://www.sec.gov/cgi-srv/efts/search#/q=${encodeURIComponent(`"${String(src?.q || '')}"`)}`,
      weight: sourceQuality('sec_edgar'),
      observed_at: when,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const edgarAdapter: SourceAdapter = {
  source: getSource('sec_edgar')!,
  async fetchEvidence(env: Env, query: EvidenceQuery): Promise<EvidenceItem[]> {
    const q = primaryTerm(query);
    if (!q) return [];
    const cacheKey = `edgar:${q.toLowerCase()}`;
    const cached = await readCache<EvidenceItem[]>(env, cacheKey);
    if (cached) return cached;
    try {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&hits=10`;
      const r = await fetchWithTimeout(url);
      if (!r.ok) return [];
      const items = parseEdgarFullText(await r.json());
      if (items.length) await writeCache(env, cacheKey, items);
      return items;
    } catch {
      return [];
    }
  },
};

/**
 * Every evidence-producing adapter the refresh fans out to, keyed for health
 * reporting. Order is irrelevant — the ingest layer dedupes and merges.
 */
export const EVIDENCE_ADAPTERS: SourceAdapter[] = [
  hnDiscussionAdapter,
  hiringAdapter,
  stackExchangeAdapter,
  githubAdapter,
  federalRegisterAdapter,
  edgarAdapter,
];

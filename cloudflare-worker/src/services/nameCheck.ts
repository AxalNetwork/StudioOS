// Task #10 — Company-name availability check.
//
// Live look-up of a proposed company name against each jurisdiction's
// official register, used by the Incorporate wizard's Confirm step.
//
// Design constraints that shape this module:
//   * The Cloudflare BROWSER binding here is the Browser-Rendering REST API
//     (`{ fetch }`), NOT @cloudflare/puppeteer — so we can only NAVIGATE to a
//     GET-able URL and parse the rendered HTML. We cannot fill forms, click,
//     or solve CAPTCHAs. Registers that are pure form-POST + CAPTCHA (e.g.
//     Delaware ICIS) therefore can't be driven via the browser binding; those
//     use a documented JSON API instead, or degrade to "verify manually".
//   * EVERY failure mode (missing binding, missing API key, non-200, parse
//     uncertainty, timeout) returns `status: 'unavailable'` — never throws.
//     A false "taken" would wrongly block a founder, and an error would break
//     the wizard, so the safe direction is always "could not check — verify
//     manually". Only an EXACT normalized-name match yields "taken".
//
// Per-registry strategy:
//   uk_ltd            → Companies House free REST API (COMPANIES_HOUSE_API_KEY,
//                       Basic auth, key-as-username) → BROWSER fallback on the
//                       public find-and-update search page.
//   us_de_ccorp/llc   → OpenCorporates REST API (OPENCORPORATES_API_KEY,
//                       jurisdiction_code us_de). Official DE ICIS can't be
//                       driven via a REST-only browser binding; without the key
//                       this degrades to "verify manually".
//   sg_pte            → data.gov.sg ACRA datastore_search (keyless JSON API;
//                       resource id via SG_ACRA_RESOURCE_ID). Unset → manual.
//   ee_oy             → Estonian e-Business Register search page via BROWSER.
//
// Results are cached (positive AND negative) in the RATE_LIMITS KV namespace
// for ~1h, keyed by jurisdiction + sha256(normalized name), so repeat lookups
// are near-instant and we don't hammer the registries.

import type { Env } from '../types';
import { sha256Hex } from './pdf';

export type NameCheckStatus = 'available' | 'taken' | 'unavailable';

export interface NameCheckResult {
  status: NameCheckStatus;
  jurisdiction_id: string;
  normalized_name: string;
  /** Exact matches (when taken) or informational near-matches (when available). */
  matches: string[];
  source: 'rest' | 'browser' | 'none';
  reason?: string;
  checked_at: string;
  cached: boolean;
}

export interface NameCheckDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Per-adapter soft timeout (ms). */
  timeoutMs?: number;
}

export type RegistryKey = 'de' | 'uk' | 'sg' | 'ee';

// Maps a wizard jurisdiction id → the register adapter that backs it. Both
// Delaware entity types resolve to the same Delaware register.
export const JURISDICTION_REGISTRY: Record<string, RegistryKey> = {
  us_de_ccorp: 'de',
  us_de_llc: 'de',
  uk_ltd: 'uk',
  sg_pte: 'sg',
  ee_oy: 'ee',
};

const CACHE_TTL_SECONDS = 3600;

// Trailing legal-suffix tokens stripped before hashing/matching so that
// "Acme, Inc.", "Acme LLC" and "Acme" all collapse to the same core name.
// Diacritics are removed first, so "OÜ" arrives here as "ou".
const LEGAL_SUFFIX_TOKENS = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'companies',
  'llc', 'lc', 'ltd', 'limited', 'plc', 'lp', 'llp', 'llp', 'pte', 'pvt',
  'private', 'gmbh', 'ag', 'oy', 'oyj', 'ou', 'as', 'sa', 'srl', 'bv', 'nv',
  'kk', 'kft', 'spa', 'sl', 'sas',
]);

/**
 * Normalize a company name to a comparable core: lowercase, strip diacritics
 * and punctuation, expand "&" → "and", collapse whitespace, and drop any
 * trailing legal-suffix tokens. Returns '' for input that is only a suffix /
 * punctuation (e.g. "Inc.") — callers treat that as "too generic to check".
 */
export function normalizeName(raw: string): string {
  const base = (raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ') // drop punctuation
    .replace(/\s+/g, ' ')
    .trim();
  let tokens = base.split(' ').filter(Boolean);
  // Strip trailing legal-suffix tokens. An all-suffix input (e.g. "Inc.")
  // collapses to '' — the dispatcher treats that as "too generic to check".
  while (tokens.length > 0 && LEGAL_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(' ');
}

/**
 * Decide availability from a registry's candidate names. "taken" requires an
 * EXACT normalized match (so a fuzzy registry search never produces a false
 * conflict); other overlapping names are surfaced as informational matches.
 */
export function decideFromCandidates(
  normalized: string,
  candidates: string[],
): { status: 'available' | 'taken'; matches: string[] } {
  const seen = new Set<string>();
  const exact: string[] = [];
  const near: string[] = [];
  for (const rawCand of candidates) {
    const clean = (rawCand || '').replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    const n = normalizeName(clean);
    if (n && n === normalized) {
      seen.add(clean);
      exact.push(clean);
    } else if (normalized && n && (n.includes(normalized) || normalized.includes(n))) {
      if (near.length < 5) { seen.add(clean); near.push(clean); }
    }
  }
  if (exact.length) return { status: 'taken', matches: exact };
  return { status: 'available', matches: near };
}

interface AdapterCtx {
  jurisdiction_id: string;
  normalized: string;
  /** Search term sent to the registry (the normalized core name). */
  core: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  now: () => Date;
}

function mk(
  ctx: AdapterCtx,
  status: NameCheckStatus,
  matches: string[],
  source: NameCheckResult['source'],
  reason?: string,
): NameCheckResult {
  return {
    status,
    jurisdiction_id: ctx.jurisdiction_id,
    normalized_name: ctx.normalized,
    matches,
    source,
    reason,
    checked_at: ctx.now().toISOString(),
    cached: false,
  };
}

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

// Never-rejecting timeout race: resolves with onTimeout() if `p` is too slow
// or rejects. Keeps the dispatcher's degradation contract airtight.
function raceTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()); } }, ms);
    p.then(finish, () => finish(onTimeout()));
  });
}

/**
 * Navigate to a GET-able URL via the Browser-Rendering REST API and return the
 * rendered HTML, or null when the binding is absent / the call fails.
 */
async function browserContent(env: Env, url: string, timeoutMs: number): Promise<string | null> {
  const browser = (env as unknown as {
    BROWSER?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  }).BROWSER;
  if (!browser) return null;
  const { signal, cancel } = abortAfter(timeoutMs);
  try {
    const res = await browser.fetch('https://browser/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle0', timeout: Math.max(2000, timeoutMs - 1500) },
      }),
      signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = (await res.json().catch(() => null)) as { result?: unknown; html?: unknown } | null;
      if (j && typeof j.result === 'string') return j.result;
      if (j && typeof j.html === 'string') return j.html;
      return null;
    }
    const txt = await res.text();
    return txt || null;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

// Extract anchor link texts whose href matches `hrefRe`. Used to pull company
// names out of a register's server-rendered search-results page.
// `hrefRe` MUST be non-global (it's reused inside the loop).
function extractAnchors(html: string, hrefRe: RegExp): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!hrefRe.test(m[1])) continue;
    const text = m[2]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push(text);
    if (out.length >= 30) break;
  }
  return out;
}

// ---------- adapters ----------

async function checkUK(env: Env, ctx: AdapterCtx): Promise<NameCheckResult> {
  const key = (env as unknown as { COMPANIES_HOUSE_API_KEY?: string }).COMPANIES_HOUSE_API_KEY;
  if (key) {
    const { signal, cancel } = abortAfter(ctx.timeoutMs);
    try {
      const url =
        `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(ctx.core)}&items_per_page=20`;
      const res = await ctx.fetchImpl(url, {
        headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: 'application/json' },
        signal,
      });
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { items?: Array<{ title?: string }> } | null;
        const items = Array.isArray(j?.items) ? j!.items! : [];
        const cands = items.map((i) => String(i?.title || '')).filter(Boolean);
        const d = decideFromCandidates(ctx.normalized, cands);
        return mk(ctx, d.status, d.matches, 'rest');
      }
      // Non-200 → fall through to the browser fallback below.
    } catch {
      /* fall through to browser */
    } finally {
      cancel();
    }
  }

  const html = await browserContent(
    env,
    `https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(ctx.core)}`,
    ctx.timeoutMs,
  );
  if (html == null) {
    return mk(ctx, 'unavailable', [], 'none', key ? 'uk_rest_failed_no_browser' : 'uk_requires_api_key_or_browser');
  }
  const cands = extractAnchors(html, /\/company\/[A-Z0-9]+/i);
  const looksValid = cands.length > 0 || /matching results|companies found|no results|we could not find|nothing found/i.test(html);
  if (!looksValid) return mk(ctx, 'unavailable', [], 'browser', 'uk_unrecognized_page');
  const d = decideFromCandidates(ctx.normalized, cands);
  return mk(ctx, d.status, d.matches, 'browser');
}

async function checkOpenCorporates(
  env: Env,
  ctx: AdapterCtx,
  jurisdictionCode: string,
  reasonNoKey: string,
): Promise<NameCheckResult> {
  const key = (env as unknown as { OPENCORPORATES_API_KEY?: string }).OPENCORPORATES_API_KEY;
  if (!key) return mk(ctx, 'unavailable', [], 'none', reasonNoKey);
  const { signal, cancel } = abortAfter(ctx.timeoutMs);
  try {
    const url =
      `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(ctx.core)}` +
      `&jurisdiction_code=${encodeURIComponent(jurisdictionCode)}&per_page=30&api_token=${encodeURIComponent(key)}`;
    const res = await ctx.fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return mk(ctx, 'unavailable', [], 'rest', `opencorporates_http_${res.status}`);
    const j = (await res.json().catch(() => null)) as
      | { results?: { companies?: Array<{ company?: { name?: string } }> } }
      | null;
    const companies = j?.results?.companies;
    if (!Array.isArray(companies)) return mk(ctx, 'unavailable', [], 'rest', 'opencorporates_bad_payload');
    const cands = companies.map((c) => String(c?.company?.name || '')).filter(Boolean);
    const d = decideFromCandidates(ctx.normalized, cands);
    return mk(ctx, d.status, d.matches, 'rest');
  } catch {
    return mk(ctx, 'unavailable', [], 'rest', 'opencorporates_error');
  } finally {
    cancel();
  }
}

async function checkSG(env: Env, ctx: AdapterCtx): Promise<NameCheckResult> {
  const resourceId = (env as unknown as { SG_ACRA_RESOURCE_ID?: string }).SG_ACRA_RESOURCE_ID;
  if (!resourceId) return mk(ctx, 'unavailable', [], 'none', 'sg_register_not_configured');
  const { signal, cancel } = abortAfter(ctx.timeoutMs);
  try {
    const url =
      `https://data.gov.sg/api/action/datastore_search?resource_id=${encodeURIComponent(resourceId)}` +
      `&q=${encodeURIComponent(ctx.core)}&limit=30`;
    const res = await ctx.fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return mk(ctx, 'unavailable', [], 'rest', `sg_http_${res.status}`);
    const j = (await res.json().catch(() => null)) as
      | { result?: { records?: Array<Record<string, unknown>> } }
      | null;
    const records = j?.result?.records;
    if (!Array.isArray(records)) return mk(ctx, 'unavailable', [], 'rest', 'sg_bad_payload');
    const cands = records
      .map((r) => String(r?.entity_name || r?.company_name || r?.name || ''))
      .filter(Boolean);
    const d = decideFromCandidates(ctx.normalized, cands);
    return mk(ctx, d.status, d.matches, 'rest');
  } catch {
    return mk(ctx, 'unavailable', [], 'rest', 'sg_error');
  } finally {
    cancel();
  }
}

async function checkEE(env: Env, ctx: AdapterCtx): Promise<NameCheckResult> {
  const html = await browserContent(
    env,
    `https://ariregister.rik.ee/eng/search?name=${encodeURIComponent(ctx.core)}&search_type=lihtparing`,
    ctx.timeoutMs,
  );
  if (html == null) return mk(ctx, 'unavailable', [], 'none', 'ee_requires_browser');
  const cands = extractAnchors(html, /\/eng\/company\//i);
  const looksValid = cands.length > 0 || /no results|results found|ei leitud|otsingu tulemus|search results/i.test(html);
  if (!looksValid) return mk(ctx, 'unavailable', [], 'browser', 'ee_unrecognized_page');
  const d = decideFromCandidates(ctx.normalized, cands);
  return mk(ctx, d.status, d.matches, 'browser');
}

/**
 * Dispatch a name check by jurisdiction, with a ~1h KV cache (positive AND
 * negative) and a hard degradation guarantee: any failure returns
 * `status: 'unavailable'`, never throws.
 */
export async function checkCompanyName(
  env: Env,
  jurisdictionId: string,
  rawName: string,
  deps: NameCheckDeps = {},
): Promise<NameCheckResult> {
  const now = deps.now || (() => new Date());
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs ?? 10000;
  const normalized = normalizeName(rawName);
  const registry = JURISDICTION_REGISTRY[jurisdictionId];

  const unavailable = (reason: string, source: NameCheckResult['source'] = 'none'): NameCheckResult => ({
    status: 'unavailable',
    jurisdiction_id: jurisdictionId,
    normalized_name: normalized,
    matches: [],
    source,
    reason,
    checked_at: now().toISOString(),
    cached: false,
  });

  if (!registry) return unavailable('unknown_jurisdiction');
  if (!normalized) return unavailable('name_too_generic');

  // Cache read (best-effort; reuse the RATE_LIMITS KV namespace).
  const kv = env.RATE_LIMITS as KVNamespace | undefined;
  let cacheKey = '';
  if (kv) {
    try {
      cacheKey = `namecheck:${jurisdictionId}:${await sha256Hex(normalized)}`;
      const hit = await kv.get(cacheKey);
      if (hit) {
        const parsed = JSON.parse(hit) as NameCheckResult;
        return { ...parsed, cached: true };
      }
    } catch {
      /* ignore cache read errors */
    }
  }

  const ctx: AdapterCtx = { jurisdiction_id: jurisdictionId, normalized, core: normalized, fetchImpl, timeoutMs, now };

  let adapterPromise: Promise<NameCheckResult>;
  switch (registry) {
    case 'uk':
      adapterPromise = checkUK(env, ctx);
      break;
    case 'de':
      adapterPromise = checkOpenCorporates(env, ctx, 'us_de', 'de_register_requires_manual_check');
      break;
    case 'sg':
      adapterPromise = checkSG(env, ctx);
      break;
    case 'ee':
      adapterPromise = checkEE(env, ctx);
      break;
    default:
      return unavailable('unknown_jurisdiction');
  }

  const result = await raceTimeout(adapterPromise, timeoutMs + 1000, () => unavailable('timeout'));

  // Cache only definitive results — never cache "unavailable" so a transient
  // outage doesn't stick the user on "verify manually" for an hour.
  if (kv && cacheKey && (result.status === 'available' || result.status === 'taken')) {
    try {
      await kv.put(cacheKey, JSON.stringify({ ...result, cached: false }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      /* ignore cache write errors */
    }
  }
  return result;
}

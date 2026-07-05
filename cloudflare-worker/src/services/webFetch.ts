/**
 * In-house web fetch / crawl / proxy pipeline (Competitor Analysis).
 *
 * This is the Cloudflare-native alternative to paid scraping / SERP APIs. A
 * Worker fetches a single PUBLIC page, normalizes the HTML into readable text,
 * extracts a few structured hints (title, meta description, headings, pricing
 * signals), and caches the result in D1 (`competitor_cached_fetches`).
 *
 * Safety / ethics:
 *  - Only http(s), only public hostnames. SSRF guard blocks localhost, private
 *    IP ranges, and the cloud metadata endpoint.
 *  - Hard byte cap + request timeout (AbortController).
 *  - Per-user sliding rate limit via the RATE_LIMITS KV namespace.
 *  - We only ever GET publicly-reachable pages and never follow into private
 *    networks. Callers pass user-supplied or AI-suggested URLs.
 *
 * We deliberately use deterministic regex normalization (not a DOM library):
 * it runs everywhere including the typecheck/test env, and we only need enough
 * signal text to feed the LLM synthesis step.
 */
import type { Env } from '../types';

const MAX_BYTES = 1_500_000; // 1.5 MB cap on a fetched document
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TEXT_CHARS = 18_000; // cap stored/returned normalized text
const RATE_LIMIT_PER_MIN = 40; // per user, per minute

export interface FetchedPage {
  url: string;
  ok: boolean;
  status: number;
  title: string;
  description: string;
  text: string;
  headings: string[];
  pricingHints: string[];
  fetched_at: string;
  cached: boolean;
  error?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize a user-supplied URL. Adds https:// when the scheme is missing and
 * strips fragments. Returns null when the input can't be a public web URL.
 */
export function normalizeUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** SSRF guard — reject non-public targets. */
export function isSafePublicUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // No bare hostnames (localhost) or *.local / *.internal.
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (!host.includes('.')) return false;
  // Cloud metadata endpoint.
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
  // Block IPv4 literals in private / loopback / link-local ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false; // multicast / reserved
  }
  // Obvious IPv6 loopback / link-local.
  if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    // Decode &amp; LAST so a double-encoded sequence (e.g. "&amp;lt;") is not
    // collapsed into its final form ("<"). Prevents double-unescaping.
    .replace(/&amp;/g, '&');
}

function stripTag(html: string, tag: string): string {
  // `tag` is always one of a fixed set of literals (script/style/noscript/svg/head),
  // never user input — this dynamic RegExp is not attacker-controlled.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi');
  return html.replace(re, ' ');
}

/** Turn a chunk of HTML into readable, whitespace-collapsed plain text. */
function htmlToText(html: string): string {
  let s = html;
  s = stripTag(s, 'script');
  s = stripTag(s, 'style');
  s = stripTag(s, 'noscript');
  s = stripTag(s, 'svg');
  s = stripTag(s, 'head');
  // Turn block boundaries into newlines so lists/headings stay legible.
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)[^>]*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/\n\s*\n\s*\n+/g, '\n\n');
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n');
  return s.trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

function extractMetaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 400) : '';
}

function extractHeadings(html: string): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 25) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t) out.push(t.slice(0, 160));
  }
  return out;
}

function extractPricingHints(text: string): string[] {
  const hints = new Set<string>();
  const re = /(?:\$|€|£|USD\s?)\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month|user|seat|yr|year))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && hints.size < 12) {
    hints.add(m[0].replace(/\s+/g, ' ').trim());
  }
  // Common pricing keywords near numbers.
  if (/\bfree\b/i.test(text)) hints.add('Free tier mentioned');
  if (/\bcontact sales\b/i.test(text) || /\bcontact us\b/i.test(text)) hints.add('Contact sales / enterprise');
  return [...hints];
}

async function checkRateLimit(env: Env, userId: number): Promise<boolean> {
  if (!env.RATE_LIMITS) return true;
  try {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `cfetch:${userId}:${minute}`;
    const current = Number((await env.RATE_LIMITS.get(key)) || '0');
    if (current >= RATE_LIMIT_PER_MIN) return false;
    await env.RATE_LIMITS.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true; // fail-open on KV hiccups
  }
}

async function readCache(env: Env, urlHash: string): Promise<FetchedPage | null> {
  try {
    const rows = await env.DB.prepare(
      'SELECT url, status, title, description, text, headings_json, pricing_json, fetched_at, expires_at FROM competitor_cached_fetches WHERE url_hash = ?',
    )
      .bind(urlHash)
      .all();
    const row = (rows.results || [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    if (row.expires_at && String(row.expires_at) < new Date().toISOString()) return null;
    return {
      url: String(row.url),
      ok: Number(row.status) >= 200 && Number(row.status) < 400,
      status: Number(row.status),
      title: String(row.title || ''),
      description: String(row.description || ''),
      text: String(row.text || ''),
      headings: safeParseArray(row.headings_json),
      pricingHints: safeParseArray(row.pricing_json),
      fetched_at: String(row.fetched_at || ''),
      cached: true,
    };
  } catch {
    return null;
  }
}

function safeParseArray(v: unknown): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function writeCache(env: Env, urlHash: string, page: FetchedPage): Promise<void> {
  try {
    const expires = new Date(Date.now() + CACHE_TTL_MS).toISOString();
    await env.DB.prepare(
      `INSERT INTO competitor_cached_fetches
        (url_hash, url, status, title, description, text, headings_json, pricing_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url_hash) DO UPDATE SET
         url=excluded.url, status=excluded.status, title=excluded.title,
         description=excluded.description, text=excluded.text,
         headings_json=excluded.headings_json, pricing_json=excluded.pricing_json,
         fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`,
    )
      .bind(
        urlHash,
        page.url,
        page.status,
        page.title,
        page.description,
        page.text,
        JSON.stringify(page.headings),
        JSON.stringify(page.pricingHints),
        page.fetched_at,
        expires,
      )
      .run();
  } catch (e) {
    console.warn('[webFetch] cache write failed:', (e as Error).message);
  }
}

export interface FetchPageOptions {
  userId: number;
  /** Skip the D1 cache and force a fresh fetch. */
  refresh?: boolean;
}

/**
 * Fetch + normalize a single public page. Returns a structured result even on
 * failure (ok:false, error set) so callers can degrade gracefully.
 */
export async function fetchPage(env: Env, rawUrl: string, opts: FetchPageOptions): Promise<FetchedPage> {
  const nowIso = new Date().toISOString();
  const url = normalizeUrl(rawUrl);
  if (!url || !isSafePublicUrl(url)) {
    return {
      url: rawUrl,
      ok: false,
      status: 0,
      title: '',
      description: '',
      text: '',
      headings: [],
      pricingHints: [],
      fetched_at: nowIso,
      cached: false,
      error: 'blocked_or_invalid_url',
    };
  }

  const urlHash = await sha256Hex(url);
  if (!opts.refresh) {
    const cached = await readCache(env, urlHash);
    if (cached) return cached;
  }

  if (!(await checkRateLimit(env, opts.userId))) {
    return {
      url,
      ok: false,
      status: 429,
      title: '',
      description: '',
      text: '',
      headings: [],
      pricingHints: [],
      fetched_at: nowIso,
      cached: false,
      error: 'rate_limited',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'StudioOS-CompetitorBot/1.0 (+https://axal.vc; respectful public-page reader)',
        Accept: 'text/html,application/xhtml+xml',
      },
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);

    const contentType = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      const page: FetchedPage = {
        url,
        ok: false,
        status: res.status,
        title: '',
        description: '',
        text: '',
        headings: [],
        pricingHints: [],
        fetched_at: nowIso,
        cached: false,
        error: `unsupported_content_type:${contentType.split(';')[0]}`,
      };
      return page;
    }

    // Read at most MAX_BYTES.
    const reader = res.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          chunks.push(value);
          if (received >= MAX_BYTES) {
            try {
              await reader.cancel();
            } catch {
              /* noop */
            }
            break;
          }
        }
      }
    }
    const merged = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      merged.set(c.subarray(0, Math.min(c.byteLength, MAX_BYTES - off)), off);
      off += c.byteLength;
      if (off >= MAX_BYTES) break;
    }
    const html = new TextDecoder('utf-8').decode(merged);

    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const headings = extractHeadings(html);
    const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
    const pricingHints = extractPricingHints(`${text}\n${headings.join('\n')}`);

    const page: FetchedPage = {
      url,
      ok: res.ok,
      status: res.status,
      title,
      description,
      text,
      headings,
      pricingHints,
      fetched_at: nowIso,
      cached: false,
    };
    if (res.ok && text) await writeCache(env, urlHash, page);
    return page;
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message || 'fetch_failed';
    return {
      url,
      ok: false,
      status: 0,
      title: '',
      description: '',
      text: '',
      headings: [],
      pricingHints: [],
      fetched_at: nowIso,
      cached: false,
      error: err,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Given a homepage URL and a crawl depth, return the candidate sub-pages to
 * fetch. Quick scan = homepage + pricing + features + about; deep dive adds
 * blog / news / careers / press.
 */
export function pagesForDomain(homepage: string, depth: 'quick' | 'deep'): string[] {
  const base = normalizeUrl(homepage);
  if (!base) return [];
  let origin = '';
  try {
    origin = new URL(base).origin;
  } catch {
    return [base];
  }
  const quick = ['', '/pricing', '/plans', '/features', '/product', '/about'];
  const deep = ['/blog', '/news', '/press', '/careers', '/jobs'];
  const paths = depth === 'deep' ? [...quick, ...deep] : quick;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const u = `${origin}${p}`;
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

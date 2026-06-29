import type { Env } from '../types';

const CACHE_TTL = 30 * 60;
const FETCH_TIMEOUT = 4000;
const UA = 'Mozilla/5.0 (compatible; AxalStudioOS/1.0; +https://axal.vc)';

export type LiveQuote = {
  symbol: string;
  name: string;
  price: number;
  prev_close: number;
  pct_change: number;
  currency: string;
  fetched_at: string;
};

export type Headline = {
  title: string;
  link: string;
  source: string;
  published: string | null;
  summary: string;
};

const TICKERS: Array<{ symbol: string; name: string }> = [
  { symbol: 'NVDA',  name: 'NVIDIA' },
  { symbol: 'MSFT',  name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'TSLA',  name: 'Tesla' },
  { symbol: 'META',  name: 'Meta' },
  { symbol: 'AAPL',  name: 'Apple' },
  { symbol: 'AMZN',  name: 'Amazon' },
  { symbol: 'AMD',   name: 'AMD' },
  { symbol: 'PLTR',  name: 'Palantir' },
  { symbol: 'SNOW',  name: 'Snowflake' },
];

const RSS_FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', source: 'TechCrunch AI' },
  { url: 'https://www.theverge.com/rss/index.xml',                        source: 'The Verge' },
  { url: 'https://www.axios.com/feeds/feed.rss',                          source: 'Axios' },
];

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init?.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function readKVCache<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.RATE_LIMITS.get(`cache:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeKVCache(env: Env, key: string, value: unknown): Promise<void> {
  try {
    await env.RATE_LIMITS.put(`cache:${key}`, JSON.stringify(value), { expirationTtl: CACHE_TTL });
  } catch {
    /* ignore cache write errors */
  }
}

async function fetchOneQuote(t: { symbol: string; name: string }): Promise<LiveQuote | null> {
  try {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${t.symbol}?interval=1d&range=2d`
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    const price = meta.regularMarketPrice as number;
    const prev = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    return {
      symbol: t.symbol,
      name: t.name,
      price: Math.round(price * 100) / 100,
      prev_close: Math.round(prev * 100) / 100,
      pct_change: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0,
      currency: meta.currency || 'USD',
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getLiveQuotes(env: Env): Promise<{ quotes: LiveQuote[]; updated_at: string; cached: boolean }> {
  const cached = await readKVCache<{ quotes: LiveQuote[]; updated_at: string }>(env, 'quotes');
  if (cached) return { ...cached, cached: true };

  const results = await Promise.all(TICKERS.map(fetchOneQuote));
  const quotes = results.filter((q): q is LiveQuote => q !== null);
  const payload = { quotes, updated_at: new Date().toISOString() };

  if (quotes.length > 0) await writeKVCache(env, 'quotes', payload);
  return { ...payload, cached: false };
}

function decodeHtmlEntities(s: string): string {
  // Strip CDATA + tags FIRST in a fixed-point loop so payloads like
  // `<scr<script>ipt>` cannot survive a single pass (CodeQL
  // js/incomplete-multi-character-sanitization). Decoding entities BEFORE
  // tag-stripping would let `&lt;script&gt;` re-enter the tag space, so we
  // must strip tags first; the loop closes the partial-overlap bypass.
  let out = s;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '');
  }
  // Now decode entities. Single pass — order matters: numeric/named entities
  // first, then `&amp;` LAST so we never produce a `&` that gets reinterpreted
  // as a fresh entity prefix (CodeQL js/double-escaping).
  out = out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
  return out.trim();
}

// Precompiled, literal per-tag matchers — avoids constructing a RegExp from a
// (here trusted, fixed) tag name on every call (CodeQL js/non-literal-regexp).
const TAG_RE: Record<string, RegExp> = {
  title: /<title[^>]*>([\s\S]*?)<\/title>/i,
  link: /<link[^>]*>([\s\S]*?)<\/link>/i,
  pubDate: /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
  'dc:date': /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i,
  description: /<description[^>]*>([\s\S]*?)<\/description>/i,
  'content:encoded': /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i,
};

function extractTag(item: string, tag: string): string {
  const re = TAG_RE[tag];
  if (!re) return '';
  const m = item.match(re);
  return m ? decodeHtmlEntities(m[1]) : '';
}

function parseRss(xml: string, source: string, limit = 5): Headline[] {
  const items: Headline[] = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = itemRe.exec(xml)) && count < limit) {
    const block = m[0];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pub = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const desc = extractTag(block, 'description') || extractTag(block, 'content:encoded');
    if (!title) continue;
    items.push({
      title: title.slice(0, 200),
      link,
      source,
      published: pub ? new Date(pub).toISOString() : null,
      summary: desc.slice(0, 280),
    });
    count++;
  }
  return items;
}

async function fetchOneFeed(feed: { url: string; source: string }): Promise<Headline[]> {
  try {
    const r = await fetchWithTimeout(feed.url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRss(xml, feed.source, 5);
  } catch {
    return [];
  }
}

export async function getMarketHeadlines(env: Env): Promise<{ headlines: Headline[]; updated_at: string; cached: boolean; sources: string[] }> {
  const cached = await readKVCache<{ headlines: Headline[]; updated_at: string; sources: string[] }>(env, 'headlines');
  if (cached) return { ...cached, cached: true };

  const all = (await Promise.all(RSS_FEEDS.map(fetchOneFeed))).flat();
  all.sort((a, b) => {
    const ta = a.published ? Date.parse(a.published) : 0;
    const tb = b.published ? Date.parse(b.published) : 0;
    return tb - ta;
  });
  const headlines = all.slice(0, 15);
  const payload = { headlines, updated_at: new Date().toISOString(), sources: RSS_FEEDS.map(f => f.source) };

  if (headlines.length > 0) await writeKVCache(env, 'headlines', payload);
  return { ...payload, cached: false };
}

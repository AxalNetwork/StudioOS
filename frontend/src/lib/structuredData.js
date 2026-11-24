/**
 * D7004 (#7004): schema.org JSON-LD for the public site, from recorded facts only.
 *
 * Four kinds, each built from what the platform already records and nothing else:
 *   - `Organization` on `/` and `/about`: the name, the site, the mark and the social accounts the footer links;
 *   - `Article` on `/articles/<slug>`: the record's title, author name and dates (the Worker writes it, D1439);
 *   - `Event` on `/events/<slug>`: only with a start date and a place or an online format (the Worker writes it);
 *   - `BreadcrumbList` on the trust center's subsections (prerendered) and on each help guide (client side).
 *
 * A property with no recorded value is left out, never filled with a guess. No rating, review, offer, price,
 * employee count or founding date is ever written: the platform records none of them for a public page, and
 * `FORBIDDEN_LD_KEYS` is what the tests check every block against.
 *
 * Plain Node ESM with explicit `.js` specifiers: `scripts/prerender-og.mjs` and the Worker import it.
 */
import { SITE_URL, ogEntryFor, normalisePath } from './ogRegistry.js';
import { SOCIAL_LINKS } from './siteLinks.js';

/** The firm's name as the site writes it. */
export const ORG_NAME = 'Axal VC';
/** The site's mark (`frontend/public/axal-mark.png`, the apple-touch-icon). */
export const ORG_LOGO = `${SITE_URL}/axal-mark.png`;

/** Properties no block may carry: the platform records none of them for a public page. */
export const FORBIDDEN_LD_KEYS = Object.freeze([
  'aggregateRating', 'review', 'reviews', 'reviewRating', 'offers', 'price', 'priceCurrency', 'lowPrice', 'highPrice',
  'numberOfEmployees', 'foundingDate', 'founder', 'founders',
]);

const CONTEXT = 'https://schema.org';
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim() : null);

/** Drop every property with no recorded value: null, undefined, '', and empty arrays or objects. */
export function compact(value) {
  if (Array.isArray(value)) {
    const out = value.map(compact).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    // An object holding only its `@type` (or nothing) states no fact.
    return Object.keys(out).some((k) => k !== '@type') ? out : undefined;
  }
  if (value == null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  return value;
}

/**
 * A D1 timestamp as ISO 8601. D1 stores `YYYY-MM-DD HH:MM:SS` in UTC, so a stamp with no zone is UTC.
 * Anything that is not a date gives null, so the property is left out.
 */
export function isoDate(v) {
  const s = text(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!m) return null;
  return `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3] ? m[3].toUpperCase() : 'Z'}`;
}

/** The firm, from the facts the site already states. */
export function organizationLd() {
  return compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    name: ORG_NAME,
    url: SITE_URL,
    logo: ORG_LOGO,
    sameAs: SOCIAL_LINKS.map((l) => https(l.href)),
  });
}

/** The publisher an article names: the firm, with no more than `organizationLd` states. */
function publisherLd() {
  return { '@type': 'Organization', name: ORG_NAME, url: SITE_URL, logo: { '@type': 'ImageObject', url: ORG_LOGO } };
}

/**
 * One published article, from its record: `{ title, author_name, published_at, updated_at, excerpt, subtitle,
 * image, path }`. `dateModified` is written only when the record's last edit is later than its publication.
 */
export function articleLd(r = {}) {
  const headline = text(r.title);
  if (!headline) return null;
  const published = isoDate(r.published_at);
  const updated = isoDate(r.updated_at);
  const url = r.path ? `${SITE_URL}${r.path}` : null;
  return compact({
    '@context': CONTEXT,
    '@type': 'Article',
    headline,
    description: text(r.excerpt) || text(r.subtitle),
    author: text(r.author_name) ? { '@type': 'Person', name: text(r.author_name) } : null,
    datePublished: published,
    dateModified: updated && published && updated > published ? updated : null,
    image: https(r.image),
    url,
    mainEntityOfPage: url,
    publisher: publisherLd(),
  });
}

const ONLINE_KINDS = new Set(['virtual', 'online']);
const PLACE_KINDS = new Set(['in_person', 'hybrid']);

/**
 * One public event, from its record: `{ title, summary, starts_at, ends_at, location_kind, location_text,
 * cover_url, path }`. Null unless the record holds a start date and either a place or an online format.
 * The join link (`location_url`) and the price are never read.
 */
export function eventLd(r = {}) {
  const name = text(r.title);
  const startDate = isoDate(r.starts_at);
  const kind = text(r.location_kind).toLowerCase();
  const online = ONLINE_KINDS.has(kind) || kind === 'hybrid';
  const place = PLACE_KINDS.has(kind) ? text(r.location_text) : '';
  if (!name || !startDate || (!online && !place)) return null;
  const mode = place && online ? 'MixedEventAttendanceMode' : online ? 'OnlineEventAttendanceMode' : 'OfflineEventAttendanceMode';
  const locations = [
    place ? { '@type': 'Place', name: place, address: place } : null,
    // No `url`: the only online address recorded is the join link, which a public page never carries.
    online ? { '@type': 'VirtualLocation' } : null,
  ].filter(Boolean);
  const url = r.path ? `${SITE_URL}${r.path}` : null;
  const event = compact({
    '@context': CONTEXT,
    '@type': 'Event',
    name,
    description: text(r.summary),
    startDate,
    endDate: isoDate(r.ends_at),
    eventAttendanceMode: `https://schema.org/${mode}`,
    image: https(r.cover_url),
    url,
  });
  // Set after `compact`, which would drop a bare `{ '@type': 'VirtualLocation' }` as stating nothing.
  event.location = locations.length === 1 ? locations[0] : locations;
  return event;
}

/** A trail of `{ name, path? }`, the last one the page itself (no `item`, as Google allows). */
export function breadcrumbLd(items) {
  const list = (items || []).filter((i) => text(i?.name));
  if (list.length < 2) return null;
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: list.map((i, n) => compact({
      '@type': 'ListItem',
      position: n + 1,
      name: text(i.name),
      item: i.path && n < list.length - 1 ? `${SITE_URL}${i.path}` : null,
    })),
  };
}

/** A help guide's trail, as its page draws it: Help, the guide's area, the guide. */
export function helpGuideBreadcrumbLd({ areaId, areaTitle, guideTitle }) {
  return breadcrumbLd([
    { name: 'Help', path: '/help' },
    { name: areaTitle, path: areaId ? `/help?view=all#area-${areaId}` : null },
    { name: guideTitle },
  ]);
}

/** The JSON-LD a prerendered route carries: none unless its facts are recorded. */
export function structuredDataFor(pathname) {
  const p = normalisePath(pathname);
  if (p === '/' || p === '/about') return [organizationLd()];
  const entry = ogEntryFor(p);
  if (p.startsWith('/trust/') && entry?.path === p) {
    const root = ogEntryFor('/trust');
    const crumb = breadcrumbLd([{ name: root?.title, path: '/trust' }, { name: entry.title }]);
    return crumb ? [crumb] : [];
  }
  return [];
}

/**
 * One `<script type="application/ld+json">`. `<`, `>` and `&` are written as `<`, `>` and `&`
 * (still the same JSON), so no value can close the script element or open a comment; U+2028 and U+2029 too.
 */
export function jsonLdScript(payload) {
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

const LD_BLOCK = /\n?[ \t]*<!-- BEGIN ld:managed[\s\S]*?<!-- END ld:managed -->/g;
const OG_END = '<!-- END og:managed -->';

/** The managed block for these payloads, or '' when there are none. */
export function structuredDataBlock(payloads) {
  const list = (payloads || []).filter(Boolean);
  if (!list.length) return '';
  return `  <!-- BEGIN ld:managed — D7004 structured data from recorded facts (frontend/src/lib/structuredData.js). -->
${list.map((p) => `  ${jsonLdScript(p)}`).join('\n')}
  <!-- END ld:managed -->`;
}

/**
 * The page with its structured data replaced: any earlier block removed, then this one written straight after
 * the `og:managed` block (or after `<head>` when there is none). Re-running gives the same bytes.
 */
export function withStructuredData(html, payloads) {
  let out = String(html).replace(LD_BLOCK, '');
  const block = structuredDataBlock(payloads);
  if (!block) return out;
  const at = out.indexOf(OG_END);
  if (at !== -1) return `${out.slice(0, at + OG_END.length)}\n${block}${out.slice(at + OG_END.length)}`;
  return out.replace(/(<head[^>]*>)/i, (m) => `${m}\n${block}`);
}

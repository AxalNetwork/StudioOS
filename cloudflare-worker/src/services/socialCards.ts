/**
 * D1439 (#3914, Part B of #3705) — record links preview as themselves.
 *
 * A shared `/events/<slug>`, `/articles/<slug>`, `/jobs/<slug>`, `/u/<handle>`,
 * `/startups/<handle>`, `/partners/<slug>`, `/authors/<id>` or
 * `/insights/public/<slug>` used to preview as the home card: the SPA shell is
 * the only HTML those paths have. These prefixes are now in both
 * `run_worker_first` lists, and `index.ts` hands them here before Hono, so the
 * shell never picks up the Worker's nonce CSP or `no-referrer`.
 *
 *   matchSocialPath  exactly one segment after the prefix; the SPA's own
 *                    literal routes (`/events/new`, `/articles/draft`, …) and
 *                    deeper paths are not cards and go out untouched.
 *   resolveCard      one bound read per kind, behind THE PAGE'S OWN public gate.
 *                    Never the route handler: the article read counts a view.
 *   rewriteShell     replaces the shell's generated `og:managed` block (written
 *                    by `scripts/prerender-og.mjs`) with the record's tags.
 *                    Everything else in the shell — every script and link tag —
 *                    is byte-identical, so the SPA boots as before.
 *
 * A missing record and a private one give the same bytes: the section's card,
 * with `x-robots-tag: noindex`. A card never confirms that a record exists. On
 * any error, or after 1.5 s, the shell goes out untouched.
 *
 * What a card never carries: an event's price, capacity, seats or join link; a
 * job's pay band; anything of a person but name and headline; a startup's
 * traction or amounts. Every value is escaped.
 */
import type { Env } from '../types';
import { DIRECTORY_LISTED_WHERE, authorSlugs, publicPersonCard, publicStartupCard } from '../routes/public';
import {
  SITE_NAME, SITE_URL, ogEntryFor, ogImageKeys, ogImageUrl, ogTagsFor,
} from '../../../frontend/src/lib/ogRegistry.js';

export type CardKind = 'event' | 'article' | 'insight' | 'job' | 'person' | 'startup' | 'partner' | 'author';
export interface SocialMatch { kind: CardKind; key: string; path: string }

export interface CardTags {
  title: string;
  description: string;
  url: string;
  image: string;
  /** False when `image` is the record's own picture, whose size and type are unknown. */
  imageIsCard: boolean;
  imageAlt: string;
  type: 'website' | 'article' | 'profile';
}

/** The run_worker_first globs this module answers, in `wrangler.toml` order. */
export const SOCIAL_CARD_GLOBS = [
  '/events/*', '/articles/*', '/jobs/*', '/u/*', '/startups/*', '/partners/*', '/authors/*', '/insights/public/*',
] as const;

const PREFIXES: ReadonlyArray<[string, CardKind]> = [
  ['/insights/public/', 'insight'],
  ['/events/', 'event'],
  ['/articles/', 'article'],
  ['/jobs/', 'job'],
  ['/u/', 'person'],
  ['/startups/', 'startup'],
  ['/partners/', 'partner'],
  ['/authors/', 'author'],
];

/** The SPA's literal one-segment routes under these prefixes (App.jsx): pages, not records. */
export const RESERVED: Readonly<Partial<Record<CardKind, readonly string[]>>> = {
  event: ['new'],
  job: ['new'],
  article: ['draft', 'mine', 'edit'],
  partner: ['onboard', 'portal'],
};

/**
 * The section each kind falls back to: the card a miss, a private record and
 * an error-free fallback all share. `null` is the Axal default card.
 */
const SECTION_PATH: Record<CardKind, string | null> = {
  event: '/events', article: '/articles', insight: '/articles', job: '/jobs', author: '/authors',
  person: null, startup: null, partner: null,
};

/**
 * The family card each kind shows when the record has no picture of its own.
 * The first key the registry knows wins: D1604 (#3913) adds `event`, `authors`
 * and `profile`; until it merges, the section's card stands in.
 */
const FAMILY_KEYS: Record<CardKind, readonly string[]> = {
  event: ['event', 'content'],
  article: ['articles', 'content'],
  insight: ['articles', 'content'],
  job: ['jobs', 'content'],
  author: ['authors', 'content'],
  person: ['profile', 'default'],
  startup: ['profile', 'default'],
  partner: ['profile', 'default'],
};

/** The shell's own headers (`frontend/public/_headers`, `/*`). `_headers` is not applied to a Worker response, so they are set here from one place. Never the Worker's CSP. */
export const SHELL_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), camera=(self), microphone=(self), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), serial=(), hid=(), interest-cohort=()',
};

export const CARD_DEADLINE_MS = 1500;
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;

/** Which card a pathname asks for, or null when it is not a record path. */
export function matchSocialPath(pathname: string): SocialMatch | null {
  for (const [prefix, kind] of PREFIXES) {
    if (!pathname.startsWith(prefix)) continue;
    let rest = pathname.slice(prefix.length);
    if (rest.endsWith('/')) rest = rest.slice(0, -1);
    if (!rest) return null;
    let key: string;
    try { key = decodeURIComponent(rest); } catch { return null; }
    // A deeper path (`/events/12/manage`), or an encoded slash, is not a record.
    if (!key || key.length > 160 || /[\u0000-\u001f/]/.test(key)) return null;
    if (RESERVED[kind]?.includes(key.toLowerCase())) return null;
    return { kind, key, path: `${prefix}${rest}` };
  }
  return null;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const oneLine = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const https = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim() : null);

function familyImage(kind: CardKind): string {
  const known = new Set(ogImageKeys());
  const key = FAMILY_KEYS[kind].find((k) => known.has(k)) || 'default';
  return ogImageUrl(key);
}

function recordTags(m: SocialMatch, r: { title: string; description: string; image?: string | null; type: CardTags['type'] }): CardTags {
  const name = clip(oneLine(r.title), TITLE_MAX - SITE_NAME.length - 3);
  const own = r.image ? https(r.image) : null;
  return {
    title: `${name} — ${SITE_NAME}`,
    description: clip(oneLine(r.description), DESCRIPTION_MAX),
    url: `${SITE_URL}${m.path}`,
    image: own || familyImage(m.kind),
    imageIsCard: !own,
    imageAlt: name,
    type: r.type,
  };
}

/** The card a miss, a private record and a non-public one all share. */
export function sectionTags(kind: CardKind): CardTags {
  const path = SECTION_PATH[kind];
  const t = path ? ogTagsFor(path) : ogTagsFor('/', { title: SITE_NAME });
  return {
    title: t.title,
    description: path ? t.description : (ogEntryFor('/')?.description || ''),
    url: path ? t.url : SITE_URL,
    image: path ? t.image : ogImageUrl('default'),
    imageIsCard: true,
    imageAlt: t.imageAlt,
    type: 'website',
  };
}

function when(startsAt: unknown, timezone: unknown): string {
  const d = new Date(String(startsAt || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(startsAt || '')) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  const tz = String(timezone || 'UTC');
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d) + ` ${tz}`;
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(d) + ' UTC';
  }
}

const LOCATION_KIND: Record<string, string> = { virtual: 'Online', online: 'Online', in_person: 'In person', hybrid: 'Hybrid' };

/** The record's card, or null when it is missing or not public. Bound reads only. */
export async function resolveCard(env: Env, m: SocialMatch): Promise<CardTags | null> {
  const db = env.DB;
  switch (m.kind) {
    case 'event': {
      // events_public.ts GET /events/:slug — owner question C (a): an unlisted event is carded.
      const r = await db.prepare(
        `SELECT title, summary, starts_at, timezone, location_kind, cover_url FROM events
          WHERE slug = ? AND status = 'published'
            AND ((visibility = 'public' AND admin_published = 1) OR visibility = 'unlisted')`,
      ).bind(m.key).first<any>();
      if (!r?.title) return null;
      const kind = LOCATION_KIND[String(r.location_kind || '').toLowerCase()] || '';
      const head = [when(r.starts_at, r.timezone), kind].filter(Boolean).join(' · ');
      return recordTags(m, { title: r.title, description: [head, oneLine(r.summary)].filter(Boolean).join('. '), image: https(r.cover_url), type: 'website' });
    }
    case 'article': {
      // articles.ts GET /:slug's gate, without its view count.
      const r = await db.prepare(
        `SELECT a.id, a.title, a.subtitle, a.excerpt, a.read_minutes, a.cover_r2_key,
                COALESCE(u.display_name, u.name) AS author_name
           FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
          WHERE a.slug = ? AND a.status = 'published' LIMIT 1`,
      ).bind(m.key).first<any>();
      if (!r?.title) return null;
      const by = [oneLine(r.author_name) ? `By ${oneLine(r.author_name)}` : '', Number(r.read_minutes) > 0 ? `${Number(r.read_minutes)} min read` : ''].filter(Boolean).join(' · ');
      const lede = oneLine(r.excerpt) || oneLine(r.subtitle);
      return recordTags(m, {
        title: r.title, description: [lede, by].filter(Boolean).join(' — '),
        image: r.cover_r2_key ? `${SITE_URL}/api/articles/cover/${Number(r.id)}` : null, type: 'article',
      });
    }
    case 'insight': {
      // market_intel_public.ts GET /publications/:slug's gate.
      if (!/^[a-z0-9-]{1,80}$/i.test(m.key)) return null;
      const r = await db.prepare(
        "SELECT title, subtitle, summary_text FROM admin_publications WHERE slug = ? AND status = 'published' LIMIT 1",
      ).bind(m.key).first<any>();
      if (!r?.title) return null;
      return recordTags(m, { title: r.title, description: oneLine(r.subtitle) || oneLine(r.summary_text), type: 'article' });
    }
    case 'job': {
      // jobs_public.ts GET /jobs/:slug's gate. Never the pay band.
      const r = await db.prepare(
        `SELECT j.title, j.location_text, j.remote, p.name AS project_name
           FROM job_postings j LEFT JOIN projects p ON p.id = j.project_id
          WHERE j.slug = ? AND j.status = 'published' AND j.admin_published = 1`,
      ).bind(m.key).first<any>();
      if (!r?.title) return null;
      const where = [oneLine(r.location_text), Number(r.remote) === 1 ? 'Remote' : ''].filter(Boolean).join(' · ');
      return recordTags(m, { title: r.title, description: [oneLine(r.project_name), where].filter(Boolean).join(' · '), type: 'website' });
    }
    case 'person': {
      // public.ts publicPersonCard, anonymous: Members-only and Hidden are not found. Name and headline only.
      const out = await publicPersonCard(env, m.key.toLowerCase(), null);
      const name = out.status === 200 ? oneLine((out.body as any).name) : '';
      if (!name) return null;
      return recordTags(m, { title: name, description: oneLine((out.body as any).headline), type: 'profile' });
    }
    case 'startup': {
      // public.ts publicStartupCard, anonymous. Name, stage, one line of description.
      const out = await publicStartupCard(env, m.key.toLowerCase(), null);
      const b: any = out.status === 200 ? out.body : null;
      if (!b?.name) return null;
      const line = oneLine(b.description).split(/(?<=[.!?])\s/)[0] || '';
      return recordTags(m, { title: b.name, description: [oneLine(b.stage), line].filter(Boolean).join(' · '), type: 'website' });
    }
    case 'partner': {
      // The directory's gate, stricter than the page read's `status = 'active'`.
      const slug = m.key.toLowerCase();
      const r = await db.prepare(
        `SELECT name, company, specialization FROM partners
          WHERE (lower(uid) = ? OR lower(referral_code) = ?) AND ${DIRECTORY_LISTED_WHERE}`,
      ).bind(slug, slug).first<any>();
      if (!r?.name) return null;
      return recordTags(m, { title: r.name, description: [oneLine(r.company), oneLine(r.specialization)].filter(Boolean).join(' · '), type: 'website' });
    }
    case 'author': {
      // public.ts GET /authors/:userId's gate: an active user with a published article, by id or slug.
      const key = m.key.trim().toLowerCase();
      let id = /^\d+$/.test(key) ? Number(key) : 0;
      if (!id) {
        if (!/^[a-z0-9-]{1,120}$/.test(key)) return null;
        const res = await db.prepare(
          `SELECT DISTINCT u.id, u.name, u.display_name
             FROM users u JOIN articles a ON a.author_user_id = u.id
            WHERE a.status = 'published' AND u.is_active = 1`,
        ).all<{ id: number; name: string | null; display_name: string | null }>();
        for (const [uid, slug] of authorSlugs(res.results || [])) if (slug === key) { id = uid; break; }
      }
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const r = await db.prepare(
        `SELECT COALESCE(u.display_name, u.name) AS name, u.headline FROM users u
          WHERE u.id = ? AND u.is_active = 1
            AND EXISTS (SELECT 1 FROM articles a WHERE a.author_user_id = u.id AND a.status = 'published') LIMIT 1`,
      ).bind(id).first<any>();
      if (!oneLine(r?.name)) return null;
      return recordTags(m, { title: r.name, description: oneLine(r.headline) || `Articles by ${oneLine(r.name)} on Axal VC.`, type: 'profile' });
    }
  }
  return null;
}

export function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The managed block, as `prerender-og.mjs` writes it, for these tags. */
export function cardBlock(t: CardTags): string {
  const e = escapeAttr;
  const lines = [
    `<title>${e(t.title)}</title>`,
    `<meta name="description" content="${e(t.description)}" />`,
    `<link rel="canonical" href="${e(t.url)}" />`,
    '',
    `<meta property="og:type" content="${e(t.type)}" />`,
    `<meta property="og:site_name" content="${e(SITE_NAME)}" />`,
    `<meta property="og:title" content="${e(t.title)}" />`,
    `<meta property="og:description" content="${e(t.description)}" />`,
    `<meta property="og:url" content="${e(t.url)}" />`,
    `<meta property="og:image" content="${e(t.image)}" />`,
    `<meta property="og:image:secure_url" content="${e(t.image)}" />`,
    ...(t.imageIsCard ? [
      '<meta property="og:image:type" content="image/png" />',
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
    ] : []),
    `<meta property="og:image:alt" content="${e(t.imageAlt)}" />`,
    '',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${e(t.title)}" />`,
    `<meta name="twitter:description" content="${e(t.description)}" />`,
    `<meta name="twitter:image" content="${e(t.image)}" />`,
    `<meta name="twitter:image:alt" content="${e(t.imageAlt)}" />`,
  ];
  return `  <!-- BEGIN og:managed — D1439 record card, written by the Worker. -->
${lines.map((l) => (l ? `  ${l}` : '')).join('\n')}
  <!-- END og:managed -->`;
}

const MANAGED = /[ \t]*<!-- BEGIN og:managed[\s\S]*?<!-- END og:managed -->/;

/** The shell with its managed block replaced, or null when it has none to replace. */
export function rewriteShell(html: string, tags: CardTags): string | null {
  if (!MANAGED.test(html)) return null;
  return html.replace(MANAGED, () => cardBlock(tags));
}

function withShellHeaders(from: Headers, extra: Record<string, string> = {}): Headers {
  const h = new Headers(from);
  for (const k of ['content-length', 'etag', 'content-security-policy', 'content-security-policy-report-only']) h.delete(k);
  for (const [k, v] of Object.entries({ ...SHELL_HEADERS, ...extra })) h.set(k, v);
  return h;
}

class Deadline extends Error {}

/**
 * The response for a record path, or null when the path is not one (the
 * caller goes on as before). Never throws.
 */
export async function serveSocialCard(request: Request, env: Env): Promise<Response | null> {
  const match = matchSocialPath(new URL(request.url).pathname);
  const method = request.method.toUpperCase();
  if (!env.ASSETS) return null;
  if (!match || (method !== 'GET' && method !== 'HEAD')) {
    const res = await env.ASSETS.fetch(request);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: withShellHeaders(res.headers) });
  }
  // The shell, unconditionally: a 304 has no body to rewrite.
  const shellReq = new Request(request.url, { method: 'GET', headers: { accept: 'text/html' } });
  const shell = await env.ASSETS.fetch(shellReq);
  const type = shell.headers.get('content-type') || '';
  if (shell.status !== 200 || !/text\/html/i.test(type)) {
    return new Response(method === 'HEAD' ? null : shell.body, { status: shell.status, statusText: shell.statusText, headers: withShellHeaders(shell.headers) });
  }
  const html = await shell.text();
  const untouched = () => new Response(method === 'HEAD' ? null : html, { status: 200, headers: withShellHeaders(shell.headers) });
  if (!env.DB) return untouched();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let card: CardTags | null;
  try {
    card = await Promise.race([
      resolveCard(env, match),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Deadline()), CARD_DEADLINE_MS); }),
    ]);
  } catch (e) {
    console.warn('[social-cards] shell untouched', match.kind, e instanceof Deadline ? 'deadline' : (e as Error)?.name || 'error');
    return untouched();
  } finally {
    if (timer) clearTimeout(timer);
  }
  const body = rewriteShell(html, card || sectionTags(match.kind));
  if (body == null) return untouched();
  const headers = withShellHeaders(shell.headers, card ? {} : { 'x-robots-tag': 'noindex' });
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}

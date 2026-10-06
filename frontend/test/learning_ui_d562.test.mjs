/**
 * D562 (#1163) — the Learning center's screens and the user menu.
 *
 * What this pins:
 *   - the menu says "Learning" and opens `/learning`, and no longer says
 *     "Articles"; the article routes still resolve to the article pages;
 *   - every Learning route resolves, behind the narrowest guard it needs;
 *   - the temporary coming-soon gate (owner, 2026-10-06): its truth table,
 *     Articles still live for a gated profile, the card on every other tab and
 *     section and on a deep route, and an admin seeing the full page;
 *   - the three live tabs, read through existing client methods in the shapes
 *     their Worker routes send;
 *   - the "Not recorded" tabs and sections, and no fake row anywhere;
 *   - each presentational component, in each of its states, with fixtures in
 *     the shapes #1158–#1162 plan.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_ui_d562.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { routeBlock } from './_routes.mjs';
import { readRoutesSource } from './_routesSource.mjs';

import {
  COMING_SOON_LINE, LEARNING_COMING_SOON, learningComingSoon,
} from '../src/pages/learning/learningAccess.js';
import {
  LEARNING_TABS, NOT_LIVE, TAB_NOT_LIVE, articleRow, eventRow, publicationRow, resolveTab, tabMode,
} from '../src/pages/learning/learningModel.js';
import { readArticles, readEvents, readPublications } from '../src/pages/learning/learningReads.js';
import LearningPage, { adminLinks } from '../src/pages/learning/LearningPage.jsx';
import { ArticleList, EventList, LearningHomeView, PublicationList, homeCoverage } from '../src/pages/learning/LearningHome.jsx';
import CourseOutline from '../src/pages/learning/CourseOutline.jsx';
import LessonPlayer from '../src/pages/learning/LessonPlayer.jsx';
import WebinarPanel from '../src/pages/learning/WebinarPanel.jsx';
import ExercisePanel from '../src/pages/learning/ExercisePanel.jsx';
import ExamFlow from '../src/pages/learning/ExamFlow.jsx';
import MyLearning from '../src/pages/learning/MyLearning.jsx';
import ProgramLearnersTable, { LearnerRecord } from '../src/pages/learning/ProgramLearnersTable.jsx';
import StudioContentTable, { STUDIO_FILTERS } from '../src/pages/learning/StudioContentTable.jsx';
import ProgramsTable from '../src/pages/learning/ProgramsTable.jsx';
import ProgramDetail from '../src/pages/learning/ProgramDetail.jsx';

// Dates are drawn in the reader's zone; pin one so the strings are stable.
process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, path = '/learning') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const text = (el, path) => flat(html(el, path));
/** The opening tag of the element carrying this test id, whatever order its attributes render in. */
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** A link's or a button's opening tag and its visible text, up to its own closing tag. */
const linkOf = (markup, id) => {
  const tag = tagOf(markup, id);
  const name = tag.slice(1).split(/[\s>]/)[0];
  const at = markup.indexOf(tag) + tag.length;
  return { tag, label: flat(markup.slice(at, markup.indexOf(`</${name}>`, at))).trim() };
};
/** A Learning route rendered the way the router renders it, params and all. */
const page = (url, pattern, props) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: pattern, element: h(LearningPage, props) }))),
);

const FOUNDER = { role: 'founder' };
const ADMIN = { role: 'admin', is_super_admin: 0 };
const SUPER = { role: 'admin', is_super_admin: 1 };

// ── Fixtures in the live routes' own shapes ───────────────────────────────

/** `publicArticleShape` (routes/articles.ts). */
const ARTICLE = {
  id: 41, slug: 'how-we-price-a-seed-round', title: 'How we price a seed round', subtitle: 'Three numbers, one page',
  excerpt: null, seo_title: null, canonical_url: null, sector: 'fintech', tags: [], cover_url: null,
  published_at: '2026-10-02 09:30:00', word_count: 1300, read_minutes: 6, views: 12,
  author: 'Ada Founder', author_user_id: 7, author_handle: null, author_role: 'founder',
  author_headline: null, author_website: null, author_bio: null, author_twitter: null, author_linkedin: null,
  author_photo_url: null, author_socials: {},
};
const ARTICLE_BARE = { id: 42, slug: 'notes', title: 'Notes from the floor', subtitle: null, published_at: null, read_minutes: null, author: null, author_role: null };
/** One row of `GET /api/market-intel-public/publications`. */
const PUBLICATION = { slug: 'q3-sector-heat', title: 'Q3 sector heat', subtitle: 'Where rounds moved', section: 'sector_heat', published_at: '2026-10-01 08:00:00' };
/** `shapeEvent` (services/eventsCommon.ts). */
const EVENT = {
  id: 5, slug: 'founder-office-hours', host_user_id: 3, project_id: null, type: 'office_hours', title: 'Founder office hours',
  summary: 'Bring one question', description: null, cover_url: null, starts_at: '2026-10-20T16:00:00.000Z',
  ends_at: '2026-10-20T17:00:00.000Z', timezone: 'UTC', location_kind: 'virtual', location_text: null, location_url: null,
  capacity: 40, waitlist_enabled: true, approval_required: false, visibility: 'public', status: 'published',
  featured: false, price_cents: 0, currency: 'usd', created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00',
};
const ICS = (slug) => `/api/public/events/${encodeURIComponent(slug)}/ics`;

const ready = (rows, extra = {}) => ({ status: 'ready', rows, ...extra });
const ARTICLES_READY = ready([articleRow(ARTICLE), articleRow(ARTICLE_BARE)], { total: 2, offset: 0 });
const PUBLICATIONS_READY = ready([publicationRow(PUBLICATION)]);
const EVENTS_READY = ready([eventRow(EVENT, ICS)]);

// ── The menu and the routes ───────────────────────────────────────────────

test('the user menu says "Learning" and opens /learning, and no longer says "Articles"', () => {
  const app = read('frontend/src/App.jsx');
  const menu = codeOnly(app.slice(app.indexOf('function UserDropdown'), app.indexOf('function PortalSwitcher')));
  assert.match(menu, /<Link to="\/learning" onClick=\{\(\) => setOpen\(false\)\}\s+className="[^"]*" role="menuitem">\s*Learning\s*<\/Link>/,
    'the menu has a "Learning" item opening /learning');
  assert.doesNotMatch(menu, />\s*Articles\s*<\/Link>/, 'the menu still has an "Articles" item');
  assert.doesNotMatch(menu, /to="\/articles\/draft"/, 'the menu still links the article editor');
  // Between Events and the Help Center, where "Articles" was.
  assert.ok(menu.indexOf('to="/my/events"') < menu.indexOf('to="/learning"'));
  assert.ok(menu.indexOf('to="/learning"') < menu.indexOf('to="/help"'));
});

/** Every route path the app declares, App.jsx and the D528 modules, minus the catch-all. */
function declaredRoutes() {
  return [...readRoutesSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
}
const bestMatch = (url) => matchRoutes(declaredRoutes().map((path) => ({ path })), url)?.at(-1)?.route.path ?? null;

test('the article routes still resolve to the article pages, and Learning takes none of them', () => {
  const src = readRoutesSource();
  for (const [url, pattern, component] of [
    ['/articles', '/articles', 'ArticlesPage'],
    ['/articles/how-we-price-a-seed-round', '/articles/:slug', 'ArticleReaderPage'],
    ['/articles/draft', '/articles/draft', 'ArticleAuthorPage'],
    ['/articles/edit/41', '/articles/edit/:id', 'ArticleAuthorPage'],
  ]) {
    assert.equal(bestMatch(url), pattern, `${url} no longer resolves to ${pattern}`);
    assert.ok(routeBlock(src, pattern).includes(`<${component} />`), `${pattern} no longer renders ${component}`);
  }
  // The legacy redirects still land on the editor.
  assert.match(routeBlock(src, '/articles/mine'), /<Navigate to="\/articles\/draft" replace \/>/);
});

const MEMBERS = "guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage";

test('every Learning route resolves, behind the narrowest guard it needs', () => {
  const src = readRoutesSource();
  // The learner routes admit every signed-in profile, `exploring` included. The
  // menu's Learning item replaced Articles, and the article list answers every
  // visitor, so a guard that turned `exploring` away took its articles.
  assert.match(routeBlock(src, '/articles'), /element=\{<ArticlesPage \/>\}/);
  assert.ok(MEMBERS.includes("'exploring'"));
  const ROUTES = [
    ['/learning', '/learning', 'home', MEMBERS],
    ['/learning/courses/seed-basics', '/learning/courses/:slug', 'course', MEMBERS],
    ['/learning/courses/seed-basics/l1', '/learning/courses/:slug/:lesson', 'lesson', MEMBERS],
    // Stage 2: a standalone video at its own address, and every item at the href D557's catalog sends.
    ['/learning/videos/v1', '/learning/videos/:uid', 'item', MEMBERS],
    ['/learning/items/r1', '/learning/items/:uid', 'item', MEMBERS],
    ['/learning/webinars/w1', '/learning/webinars/:slug', 'webinar', MEMBERS],
    ['/learning/exercises/e1', '/learning/exercises/:slug', 'exercise', MEMBERS],
    ['/learning/exams/x1', '/learning/exams/:slug', 'exam', MEMBERS],
    ['/learning/me', '/learning/me', 'me', MEMBERS],
    ['/learning/programs', '/learning/programs', 'programs', "guard(['admin'], <LearningPage"],
    ['/learning/programs/p1', '/learning/programs/:program', 'program', "guard(['admin'], <LearningPage"],
    ['/learning/studio', '/learning/studio', 'studio', "guard(['admin'], hqOnly(<LearningPage"],
    ['/learning/studio/programs', '/learning/studio/programs', 'studioPrograms', "guard(['admin'], hqOnly(<LearningPage"],
    ['/learning/studio/programs/p1', '/learning/studio/programs/:program', 'studioProgram', "guard(['admin'], hqOnly(<LearningPage"],
  ];
  for (const [url, pattern, view, gate] of ROUTES) {
    assert.equal(bestMatch(url), pattern, `${url} does not resolve to ${pattern}`);
    const block = routeBlock(src, pattern, 1);
    assert.ok(block.includes(gate), `${pattern} is not behind ${gate}`);
    assert.ok(block.includes(`view="${view}"`), `${pattern} does not render the ${view} view`);
    assert.ok(block.includes('user={user} activeRole={effectiveRole}'), `${pattern} does not hand the gate its user and role`);
  }
  assert.equal(declaredRoutes().filter((p) => p.startsWith('/learning')).length, ROUTES.length, 'a Learning route is declared that this test does not pin');
  // The module is wired through App.jsx's D528 block.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /^import learningRoutes from '\.\/routes\/learning';$/m);
  assert.match(codeOnly(app), /\{learningRoutes\(routeTools\)\}/);
});

// ── The coming-soon gate ──────────────────────────────────────────────────

test('the gate: every non-admin profile sees coming soon, admin and Super Admin do not', () => {
  assert.equal(LEARNING_COMING_SOON, true, 'the gate is on until the content exists');
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'exploring', 'a_role_added_later']) {
    assert.equal(learningComingSoon({ role }), true, `${role} should see coming soon`);
  }
  assert.equal(learningComingSoon({}), true, 'a profile with no role is gated');
  assert.equal(learningComingSoon(null), true, 'no profile at all is gated');
  assert.equal(learningComingSoon(ADMIN), false, 'an admin sees the whole Learning center');
  assert.equal(learningComingSoon(SUPER), false, 'the Super Admin sees the whole Learning center');
  assert.equal(learningComingSoon({ role: 'admin' }), false);
});

test('the gate follows the browsed role, and lifting the switch opens Learning to everyone', () => {
  // "View as": the admin checks what a founder sees, coming-soon card and all.
  assert.equal(learningComingSoon(ADMIN, 'founder'), true);
  assert.equal(learningComingSoon(SUPER, 'investor'), true);
  assert.equal(learningComingSoon(SUPER, 'admin'), false);
  // Impersonation: `user` IS the impersonated account.
  assert.equal(learningComingSoon({ role: 'partner' }, 'partner'), true);
  // The lift: one switch, and every profile gets the Learning center.
  for (const user of [FOUNDER, { role: 'advisor' }, ADMIN, SUPER]) assert.equal(learningComingSoon(user, user.role, false), false);
  const src = read('frontend/src/pages/learning/learningAccess.js');
  assert.match(src, /TEMPORARY, BY THE OWNER'S REQUEST ON 2026-10-06/);
  assert.match(src, /TO LIFT IT, set `LEARNING_COMING_SOON` to `false`/);
  assert.match(src, /export const LEARNING_COMING_SOON = true;/);
  // One gate: every Learning page asks this function and nothing else decides it.
  const pageSrc = codeOnly(read('frontend/src/pages/learning/LearningPage.jsx'));
  assert.match(pageSrc, /const gated = learningComingSoon\(user, activeRole \?\? user\?\.role\);/);
});

test('the routed page applies the gate to the role being browsed', () => {
  assert.match(page('/learning', '/learning', { view: 'home', user: ADMIN, activeRole: 'founder' }), /data-testid="learning-coming-soon-sections"/,
    'an admin viewing as a founder sees the founder page');
  assert.doesNotMatch(page('/learning', '/learning', { view: 'home', user: ADMIN, activeRole: 'admin' }), /learning-coming-soon/);
});

// ── The three live tabs ───────────────────────────────────────────────────

test('the three live tabs read existing client methods whose Worker routes exist', () => {
  const worker = read('cloudflare-worker/src/index.ts');
  assert.match(worker, /app\.route\('\/api\/articles', articlesRoutes\);/);
  assert.match(worker, /app\.route\('\/api\/market-intel-public', marketIntelPublic\);/);
  assert.match(worker, /app\.route\('\/api\/public', eventsPublicRoutes\);/);
  assert.match(read('cloudflare-worker/src/routes/articles.ts'), /articles\.get\('\/', async/);
  assert.match(read('cloudflare-worker/src/routes/market_intel_public.ts'), /marketIntelPublic\.get\('\/publications', async/);
  assert.match(read('cloudflare-worker/src/routes/events_public.ts'), /eventsPublic\.get\('\/events', async/);
  // The fields the rows read are the fields those routes send.
  const articles = read('cloudflare-worker/src/routes/articles.ts');
  const shape = articles.slice(articles.indexOf('function publicArticleShape'), articles.indexOf('function authorArticleShape'));
  for (const field of ['slug', 'title', 'subtitle', 'published_at', 'read_minutes', 'author', 'author_role']) {
    assert.ok(shape.includes(`\n    ${field}: `), `publicArticleShape no longer sends ${field}`);
  }
  assert.match(read('cloudflare-worker/src/routes/market_intel_public.ts'), /SELECT slug, title, subtitle, section, published_at FROM admin_publications WHERE status = 'published'/);
  const events = read('cloudflare-worker/src/services/eventsCommon.ts');
  const shapeEvent = events.slice(events.indexOf('export function shapeEvent'), events.indexOf('export function shapeAgendaItem'));
  for (const field of ['slug', 'title', 'type', 'starts_at', 'timezone', 'location_kind', 'location_text']) {
    assert.ok(shapeEvent.includes(`\n    ${field}: `), `shapeEvent no longer sends ${field}`);
  }
  // And the client methods are the ones api.js already had.
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /request\(`\/articles\?\$\{qs\.toString\(\)\}`\)/);
  assert.match(api, /publicList: \(\) => request\('\/market-intel-public\/publications'\)/);
  assert.match(api, /return request\(`\/public\/events\?\$\{qs\.toString\(\)\}`\);/);
});

test('each read sends its route what it takes, and a reply in the wrong shape is unreadable, not empty', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const replies = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url)]);
    return new Response(JSON.stringify(replies.shift() ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  let a; let p; let e;
  try {
    replies.push({ items: [ARTICLE], total: 21, limit: 20, offset: 20 });
    a = await readArticles({ q: 'seed', page: 1 });
    replies.push({ publications: [PUBLICATION] });
    p = await readPublications();
    replies.push({ events: [EVENT] });
    e = await readEvents({ q: 'office' });
    replies.push({});
    await assert.rejects(readArticles(), /cannot read/);
    replies.push({ ok: true });
    await assert.rejects(readPublications(), /cannot read/);
    replies.push({ items: [] });
    await assert.rejects(readEvents(), /cannot read/);
  } finally {
    globalThis.fetch = orig;
  }
  assert.deepEqual(calls.map(([m, u]) => [m, u.replace(/^.*\/api/, '')]), [
    ['GET', '/articles?limit=20&offset=20&q=seed'],
    ['GET', '/market-intel-public/publications'],
    ['GET', '/public/events?limit=20&offset=0&q=office'],
    ['GET', '/articles?limit=20&offset=0'],
    ['GET', '/market-intel-public/publications'],
    ['GET', '/public/events?limit=20&offset=0'],
  ]);
  assert.equal(a.total, 21);
  assert.equal(a.offset, 20);
  assert.deepEqual(a.rows[0], {
    kind: 'article', key: 'article:41', title: 'How we price a seed round', href: '/articles/how-we-price-a-seed-round',
    summary: 'Three numbers, one page', author: 'Ada Founder', role: 'Founder', date: '2026-10-02 09:30:00', readMinutes: 6,
  });
  assert.equal(p.rows[0].href, '/insights/public/q3-sector-heat');
  assert.equal(p.rows[0].section, 'Sector Heat');
  assert.equal(e.rows[0].href, '/events/founder-office-hours');
  assert.equal(e.rows[0].icsHref, '/api/public/events/founder-office-hours/ics');
  assert.equal(e.rows[0].place, 'Online');
});

test('Articles: author, role, date and reading time from the route, each row opening the reader', () => {
  const markup = html(h(ArticleList, { state: ARTICLES_READY, q: '', onPage: () => {} }));
  const out = flat(markup);
  assert.match(markup, /href="\/articles\/how-we-price-a-seed-round"/);
  assert.match(out, /How we price a seed round Three numbers, one page Ada Founder Founder · 2 Oct 2026 · 6 min read/);
  // No reading time is drawn where the route sends none; a missing author and date say so.
  assert.match(out, /Notes from the floor Author not recorded · Date not recorded/);
  assert.doesNotMatch(out, /Notes from the floor[^]*min read/);
  assert.doesNotMatch(out, /Date not recorded 0/, 'an absent reading time was drawn as 0');
  assert.equal(articleRow(ARTICLE_BARE).readMinutes, null);
  assert.equal(articleRow({ ...ARTICLE, read_minutes: 0 }).readMinutes, null, 'a zero reading time is not a reading time');
  assert.match(out, /1–2 of 2 · each opens in the article reader/);
  assert.equal((markup.match(/data-testid="row-article"/g) || []).length, 2);
  // The pager: newer is disabled on the first page, older when the total is reached.
  assert.match(tagOf(markup, 'button-articles-prev'), /disabled=""/);
  assert.match(tagOf(markup, 'button-articles-next'), /disabled=""/);
  const more = html(h(ArticleList, { state: { ...ARTICLES_READY, total: 57 }, q: '', onPage: () => {} }));
  assert.doesNotMatch(tagOf(more, 'button-articles-next'), /disabled=""/);
  assert.match(flat(more), /1–2 of 57/);
});

test('Publications: title, date and section, the public page, and the PDF said to be not recorded', () => {
  const markup = html(h(PublicationList, { state: PUBLICATIONS_READY, q: '' }));
  const out = flat(markup);
  assert.match(markup, /href="\/insights\/public\/q3-sector-heat"/);
  assert.match(out, /Q3 sector heat Where rounds moved 1 Oct 2026 · Sector Heat · PDF not recorded/);
  assert.match(markup, /title="The published list carries no file\. A PDF is rendered by an admin and shared as a 24-hour link\."/);
  assert.match(out, /1 publication\b/);
  // The route takes no query, so the search filters the list it sent.
  assert.match(text(h(PublicationList, { state: PUBLICATIONS_READY, q: 'heat' })), /Q3 sector heat/);
  assert.match(text(h(PublicationList, { state: PUBLICATIONS_READY, q: 'nothing like it' })), /No publication matches “nothing like it”/);
});

test('Events: upcoming, in the event’s own time zone, with its calendar file', () => {
  const markup = html(h(EventList, { state: EVENTS_READY, q: '' }));
  const out = flat(markup);
  assert.match(out, /Tue, 20 Oct 2026, 16:00 UTC Founder office hours Office Hours Online/);
  assert.match(markup, /href="\/events\/founder-office-hours"/);
  assert.match(markup, /href="\/api\/public\/events\/founder-office-hours\/ics" download=""/);
  const zurich = eventRow({ ...EVENT, timezone: 'Europe/Zurich', location_kind: 'physical', location_text: 'Zurich' }, ICS);
  assert.match(text(h(EventList, { state: ready([zurich]), q: '' })), /18:00 CEST Founder office hours Office Hours Zurich/);
});

test('each live list draws loading, unreadable and empty, and a failed read is never "nothing published"', () => {
  for (const [List, props, claim] of [
    [ArticleList, { onPage: () => {} }, 'This is not a claim that no article is published.'],
    [PublicationList, {}, 'This is not a claim that nothing is published.'],
    [EventList, {}, 'This is not a claim that no event is planned.'],
  ]) {
    assert.match(html(h(List, { ...props, state: { status: 'loading', rows: [] }, q: '' })), /data-testid="learning-loading"/);
    const bad = html(h(List, { ...props, state: { status: 'unreadable', rows: [] }, q: '', onRetry: () => {} }));
    assert.match(bad, /data-testid="learning-unreadable"/);
    assert.ok(flat(bad).includes(claim));
    assert.doesNotMatch(bad, /learning-empty/);
    assert.match(html(h(List, { ...props, state: ready([], { total: 0, offset: 0 }), q: '' })), /data-testid="learning-empty"/);
  }
  assert.match(text(h(ArticleList, { state: ready([], { total: 0, offset: 0 }), q: '', onPage: () => {} })), /No article published yet/);
  assert.match(text(h(ArticleList, { state: ready([], { total: 0, offset: 0 }), q: 'zeta', onPage: () => {} })), /No article matches “zeta”/);
});

// ── The home: Not recorded, and the gate ──────────────────────────────────

const homeView = (props) => h(LearningHomeView, {
  articles: ARTICLES_READY, publications: PUBLICATIONS_READY, events: EVENTS_READY, ...props,
});

test('an admin: the three tabs and two sections still waiting on a store are not recorded, each with its line, and no row is drawn', () => {
  // Stage 2: Courses and Videos read D557's catalog; Webinars (#1161), Exercises and Exams (#1160) wait.
  assert.deepEqual(LEARNING_TABS.filter((t) => !t.live).map((t) => t.key), ['webinars', 'exercises', 'exams']);
  for (const [tab, line] of [['webinars', 'Webinars are not live yet.'], ['exercises', 'Exercises are not live yet.'], ['exams', 'Exams are not live yet.']]) {
    assert.equal(tabMode(tab, false), 'not_live');
    assert.equal(TAB_NOT_LIVE[tab], line);
    const markup = html(homeView({ gated: false, tab }));
    const panel = markup.slice(markup.indexOf(`data-testid="panel-${tab}"`));
    assert.match(panel, /data-mode="not_live"/);
    assert.ok(flat(panel).includes(`Not recorded ${line}`), `the ${tab} tab does not say it is not recorded`);
    assert.doesNotMatch(panel, /data-testid="row-|catalog-row-|list-/, `the ${tab} tab draws a row`);
  }
  for (const tab of ['all', 'courses', 'videos']) assert.equal(tabMode(tab, false), 'live');
  const home = html(homeView({ gated: false, tab: 'all' }));
  for (const [section, line] of [['section-programs', NOT_LIVE.programs], ['section-webinars', NOT_LIVE.webinars]]) {
    const at = home.indexOf(`data-testid="${section}"`);
    assert.ok(at >= 0, `${section} is missing`);
    assert.ok(flat(home.slice(at, at + 900)).includes(`Not recorded ${line}`), `${section} does not say it is not recorded`);
  }
  // Continue learning reads `GET /me` now: before the read it is loading, never "not live".
  const continuing = home.slice(home.indexOf('data-testid="section-continue"'), home.indexOf('data-testid="section-programs"'));
  assert.match(continuing, /learning-loading/);
  assert.doesNotMatch(continuing, /learning-not-live/);
  assert.doesNotMatch(home, /learning-coming-soon/);
});

test('a gated profile: Articles open by default, every other tab and section one coming-soon card', () => {
  assert.equal(resolveTab(null, true), 'articles');
  assert.equal(resolveTab('nonsense', true), 'articles');
  assert.equal(resolveTab('events', true), 'events');
  assert.equal(COMING_SOON_LINE, 'Courses, videos, webinars and more are coming soon. Articles are open now.');
  // Articles works exactly as built.
  const articles = html(homeView({ gated: true, tab: 'articles' }));
  assert.match(articles, /data-testid="list-articles"/);
  assert.match(articles, /href="\/articles\/how-we-price-a-seed-round"/);
  assert.deepEqual(linkOf(articles, 'link-write-article').label, 'Write an article');
  assert.match(tagOf(articles, 'link-write-article'), /href="\/articles\/draft"/);
  assert.match(articles, /placeholder="Search articles"/);
  // The three sections are one card, not three, and not the not-recorded line.
  assert.equal((articles.match(/data-testid="learning-coming-soon-sections"/g) || []).length, 1);
  assert.doesNotMatch(articles, /section-continue|section-programs|section-webinars|learning-not-live/);
  assert.ok(flat(articles).includes(COMING_SOON_LINE));
  // Every other tab: the card, and nothing from its list.
  for (const t of LEARNING_TABS.filter((x) => x.key !== 'articles')) {
    assert.equal(tabMode(t.key, true), 'coming_soon');
    const markup = html(homeView({ gated: true, tab: t.key }));
    const panel = markup.slice(markup.indexOf(`data-testid="panel-${t.key}"`));
    assert.match(panel, /data-mode="coming_soon"/);
    assert.match(panel, /data-testid="learning-coming-soon"/);
    assert.doesNotMatch(panel, /data-testid="list-|data-testid="row-|catalog-row-|learning-not-live/, `${t.key} leaks its list to a gated profile`);
    assert.doesNotMatch(markup, /input-learning-search/, 'a closed tab offers a search');
  }
  // The container: a gated profile lands on Articles, and a deep link to a closed tab shows the card.
  const landing = page('/learning', '/learning', { view: 'home', user: FOUNDER, activeRole: 'founder' });
  assert.match(tagOf(landing, 'tab-articles'), /aria-selected="true"/);
  assert.match(tagOf(landing, 'tab-all'), /aria-selected="false"/);
  assert.match(tagOf(landing, 'panel-articles'), /data-mode="live"/);
  const deep = page('/learning?tab=courses', '/learning', { view: 'home', user: FOUNDER, activeRole: 'founder' });
  assert.match(tagOf(deep, 'panel-courses'), /data-mode="coming_soon"/);
});

test('a gated profile on a deep Learning route sees the coming-soon card in place', () => {
  // `wired` views read D557 (stage 2): before the read an admin sees them loading.
  // The rest still wait on their stores, and an admin sees them not recorded.
  for (const [url, pattern, view, body, wired] of [
    ['/learning/courses/seed-basics', '/learning/courses/:slug', 'course', 'course-outline', true],
    ['/learning/courses/seed-basics/l1', '/learning/courses/:slug/:lesson', 'lesson', 'lesson-player', true],
    ['/learning/videos/v1', '/learning/videos/:uid', 'item', 'lesson-player', true],
    ['/learning/items/r1', '/learning/items/:uid', 'item', 'lesson-player', true],
    ['/learning/webinars/w1', '/learning/webinars/:slug', 'webinar', 'webinar-panel', false],
    ['/learning/exercises/e1', '/learning/exercises/:slug', 'exercise', 'exercise-panel', false],
    ['/learning/exams/x1', '/learning/exams/:slug', 'exam', 'exam-flow', false],
    ['/learning/me', '/learning/me', 'me', 'my-learning', true],
  ]) {
    for (const role of ['founder', 'investor', 'partner', 'advisor']) {
      const markup = page(url, pattern, { view, user: { role }, activeRole: role });
      assert.match(markup, /data-testid="learning-coming-soon"/, `${role} at ${url} does not see the card`);
      assert.ok(!markup.includes(`data-testid="${body}"`), `${role} at ${url} sees the ${view} body`);
      assert.doesNotMatch(markup, /learning-loading/, `${role} at ${url} starts a Learning read`);
      assert.match(tagOf(markup, 'link-coming-soon-articles'), /href="\/learning\?tab=articles"/, 'the card points at the open tab');
    }
    // The admin sees the surface itself.
    const admin = page(url, pattern, { view, user: ADMIN, activeRole: 'admin' });
    assert.doesNotMatch(admin, /learning-coming-soon/);
    assert.ok(admin.includes(`data-testid="${body}"`), `the admin at ${url} does not see the ${view} body`);
    if (wired) assert.match(admin, /data-testid="learning-loading"/, `${url} does not read its store`);
    else assert.match(admin, /data-testid="learning-not-live"/);
  }
});

test('an admin and the Super Admin see the full page: no card, All first, the studio link for the Super Admin only', () => {
  const admin = page('/learning', '/learning', { view: 'home', user: ADMIN, activeRole: 'admin' });
  assert.doesNotMatch(admin, /learning-coming-soon/);
  assert.match(tagOf(admin, 'tab-all'), /aria-selected="true"/);
  assert.match(admin, /data-testid="section-continue"/);
  assert.match(admin, /href="\/learning\/programs"/);
  assert.doesNotMatch(admin, /href="\/learning\/studio"/);
  const holder = page('/learning', '/learning', { view: 'home', user: SUPER, activeRole: 'admin' });
  assert.match(holder, /href="\/learning\/studio"/);
  assert.deepEqual(adminLinks(SUPER, 'founder', true), [], 'a gated view gets no admin links');
  // The studio and the program views draw their surfaces for the roles their routes admit.
  assert.match(page('/learning/studio', '/learning/studio', { view: 'studio', user: SUPER, activeRole: 'admin' }), /data-testid="studio-content"/);
  assert.match(page('/learning/studio/programs', '/learning/studio/programs', { view: 'studioPrograms', user: SUPER, activeRole: 'admin' }), /data-testid="programs-studio"/);
  assert.match(page('/learning/studio/programs/p1', '/learning/studio/programs/:program', { view: 'studioProgram', user: SUPER, activeRole: 'admin' }), /data-testid="program-detail"/);
  assert.match(page('/learning/programs', '/learning/programs', { view: 'programs', user: ADMIN, activeRole: 'admin' }), /data-testid="programs-assigned"/);
  const program = page('/learning/programs/p1', '/learning/programs/:program', { view: 'program', user: ADMIN, activeRole: 'admin' });
  assert.match(program, /data-testid="program-learners"/);
  assert.match(flat(program), /Read-only Assigned to you by a Super Admin\. Content and enrolment are managed at HQ\./);
});

test('the Worker AI rail sits on every Learning page, with a literal accent, in Eadwyn’s own voice', () => {
  const home = flat(page('/learning', '/learning', { view: 'home', user: FOUNDER, activeRole: 'founder' }));
  assert.match(home, /Worker AI · Learning/);
  assert.match(flat(page('/learning/studio', '/learning/studio', { view: 'studio', user: SUPER, activeRole: 'admin' })), /Worker AI · Learning studio/);
  assert.match(flat(page('/learning/programs/p1', '/learning/programs/:program', { view: 'program', user: ADMIN, activeRole: 'admin' })), /Worker AI · Learning programs/);
  const dir = resolve(ROOT, 'frontend/src/pages/learning');
  const rails = readdirSync(dir).filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  const mounts = [...codeOnly(rails).matchAll(/<WorkerRail[\s\S]*?\/>/g)].map((m) => m[0]);
  // The home, the three tiers of a page that waits on its store, the learner pages that read, the studio,
  // and, in stage 3, the assigned admin's program pages and the studio's program pages (D558) and
  // the exercise and exam pages (D559).
  assert.equal(mounts.length, 9);
  for (const tier of ['founder', 'admin', 'super_admin']) assert.ok(mounts.some((m) => m.includes(`role="${tier}"`)), `no ${tier} rail`);
  for (const mount of mounts) {
    assert.match(mount, /workspace="Learning[^"]*"/);
    assert.match(mount, /role="(founder|admin|super_admin)"/);
    const note = /note="([^"]*)"/.exec(mount)?.[1] || '';
    assert.match(note, /^Eadwyn /);
    assert.doesNotMatch(note, /advis|recommend|fiduciar/i, 'the rail speaks in regulated terms');
  }
  // Coverage counts only what was read: a failed source drops its line.
  assert.deepEqual(homeCoverage({ gated: false, q: '', articles: ARTICLES_READY, publications: { status: 'unreadable', rows: [] }, events: EVENTS_READY }),
    ['2 published articles', '1 upcoming event read']);
});

// ── The presentational components ─────────────────────────────────────────

const COURSE = { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', level: 'intro', estimated_minutes: 80 };
const MODULES = [
  { uid: 'm2', title: 'Pricing', position: 2, lessons: [
    { uid: 'l3', title: 'Pricing a round', position: 1, kind: 'video', ref_uid: 'i3', required: 1, duration_seconds: 900, progress: null },
    { uid: 'l4', title: 'Check yourself', position: 2, kind: 'exam', ref_uid: 'x1', required: 0, duration_seconds: null, progress: null },
  ] },
  { uid: 'm1', title: 'Foundations', position: 1, lessons: [
    { uid: 'l2', title: 'Reading the term sheet', position: 2, kind: 'reading', ref_uid: 'i2', required: 1, duration_seconds: 480, progress: { status: 'completed' } },
    { uid: 'l1', title: 'What a seed round is', position: 1, kind: 'video', ref_uid: 'i1', required: 1, duration_seconds: 720, progress: { status: 'completed' } },
  ] },
];

test('CourseOutline: modules then lessons, kind, length and tick; a module totals only when every lesson is timed', () => {
  const markup = html(h(CourseOutline, { status: 'ready', course: COURSE, modules: MODULES }));
  const out = flat(markup);
  assert.ok(out.indexOf('Module 1 · Foundations') < out.indexOf('Module 2 · Pricing'), 'modules are not in position order');
  assert.ok(out.indexOf('What a seed round is') < out.indexOf('Reading the term sheet'), 'lessons are not in position order');
  assert.match(out, /Module 1 · Foundations 2 lessons · 20 min/);
  assert.match(out, /Module 2 · Pricing 2 lessons · length not recorded/, 'a module with an untimed lesson was given a total');
  assert.match(out, /What a seed round is · Video 12 min/);
  assert.match(out, /Check yourself · Exam Optional Length not recorded/);
  assert.match(out, /50% · 2 of 4 lessons/);
  assert.match(out, /Intro 1 h 20 min 4 lessons/);
  assert.match(markup, /data-testid="lesson-done-l1"/);
  assert.match(markup, /data-testid="lesson-done-l2"/);
  assert.doesNotMatch(markup, /lesson-done-l3|lesson-done-l4/);
  assert.match(markup, /href="\/learning\/courses\/seed-basics\/l1"/);
  assert.match(markup, /href="\/learning\/exams\/x1"/);
  // "Continue" goes to the first lesson not yet ticked.
  const go = linkOf(markup, 'link-course-continue');
  assert.equal(go.label, 'Continue');
  assert.match(go.tag, /href="\/learning\/courses\/seed-basics\/l3"/);
  const compact = html(h(CourseOutline, { status: 'ready', course: COURSE, modules: MODULES, compact: true, currentLessonUid: 'l2' }));
  assert.doesNotMatch(compact, /course-summary/);
  assert.match(tagOf(compact, 'lesson-row-l2'), /aria-current="step"/);
  assert.doesNotMatch(tagOf(compact, 'lesson-row-l1'), /aria-current/);
});

test('LessonPlayer: video, embed, reading, the transcript not recorded, Mark complete only with a handler', () => {
  const lesson = { uid: 'l1', title: 'What a seed round is', kind: 'video' };
  const item = { uid: 'i1', kind: 'video', title: 'What a seed round is', duration_seconds: 720, thumbnail_url: null };
  const video = html(h(LessonPlayer, { status: 'ready', lesson, item, video: { src: '/media/i1', embed: false }, moduleTitle: 'Foundations', position: '1 of 4', next: { title: 'Reading the term sheet', href: '/learning/courses/seed-basics/l2' } }));
  assert.match(video, /<video[^>]*src="\/media\/i1"/);
  assert.match(tagOf(video, 'link-lesson-next'), /href="\/learning\/courses\/seed-basics\/l2"/);
  assert.match(flat(video), /Transcript Not recorded · No transcript is recorded for this video\./);
  assert.match(tagOf(video, 'button-mark-complete'), /disabled=""/, 'Mark complete looks live with nothing to save it');
  const live = html(h(LessonPlayer, { status: 'ready', lesson, item, video: { src: '/media/i1', embed: false }, onMarkComplete: () => {} }));
  assert.ok(tagOf(live, 'button-mark-complete'));
  assert.doesNotMatch(tagOf(live, 'button-mark-complete'), /disabled=""/);
  assert.match(html(h(LessonPlayer, { status: 'ready', lesson, item, video: null, completed: true })), /data-testid="text-lesson-completed"/);
  assert.match(html(h(LessonPlayer, { status: 'ready', lesson, item, video: { src: 'https://www.youtube-nocookie.com/embed/abc', embed: true } })), /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/abc"/);
  assert.match(html(h(LessonPlayer, { status: 'ready', lesson, item, video: null })), /data-testid="lesson-video-absent"/);
  const reading = html(h(LessonPlayer, { status: 'ready', lesson: { uid: 'l2', title: 'Term sheets', kind: 'reading' }, item: { uid: 'i2', kind: 'reading', body: '## Term sheets\n\nRead **this** first.' } }));
  assert.match(reading, /<h2>Term sheets<\/h2>/);
  assert.match(reading, /<strong>this<\/strong>/);
  assert.doesNotMatch(reading, /lesson-transcript/, 'a reading has no transcript panel');
  assert.match(html(h(LessonPlayer, { status: 'ready', lesson: { uid: 'l2', kind: 'reading' }, item: { uid: 'i2', kind: 'reading', body: '  ' } })), /learning-empty/);
});

const START = Date.parse('2026-10-20T16:00:00Z');
const END = Date.parse('2026-10-20T17:00:00Z');
const WEBINAR = {
  uid: 'w1', title: 'Raising a seed round', abstract: 'Questions to HQ, live.', host_name: 'Hana Host', starts_at: '2026-10-20T16:00:00Z',
  ends_at: '2026-10-20T17:00:00Z', timezone: 'UTC', capacity: 50, registered_count: 12, join_url: 'https://meet.example.com/abc',
  recording_item_uid: null, status: 'published',
};
const webinar = (props) => html(h(WebinarPanel, { status: 'ready', webinar: WEBINAR, ...props }));

test('WebinarPanel: upcoming, inside the join window, live, past with and without a recording, cancelled, full', () => {
  const upcoming = webinar({ now: START - 2 * 86400000, registration: null, icsHref: '/ics/w1' });
  assert.match(upcoming, /data-phase="upcoming"/);
  assert.match(upcoming, /data-testid="button-webinar-register"/);
  assert.match(upcoming, /href="\/ics\/w1" download=""/);
  assert.doesNotMatch(upcoming, /link-webinar-join/);
  assert.match(flat(upcoming), /Host Hana Host · capacity 50 · 12 registered/);
  assert.match(flat(upcoming), /Tue, 20 Oct 2026, 16:00 UTC · 1 h 00 min/);
  // Registered, an hour out: the link the server once sent is not drawn outside its window.
  const early = webinar({ now: START - 3600000, registration: { registered: true } });
  assert.doesNotMatch(early, /link-webinar-join/);
  assert.match(flat(early), /The join link appears here 15 minutes before the start\./);
  const inWindow = webinar({ now: START - 10 * 60000, registration: { registered: true } });
  const join = tagOf(inWindow, 'link-webinar-join');
  assert.match(join, /href="https:\/\/meet\.example\.com\/abc"/);
  assert.match(join, /target="_blank"/);
  assert.match(join, /rel="noopener noreferrer"/);
  const live = webinar({ now: START + 10 * 60000, registration: { registered: true } });
  assert.match(live, /data-phase="live"/);
  assert.match(live, /data-testid="link-webinar-join"/);
  assert.doesNotMatch(webinar({ now: START + 10 * 60000, registration: null }), /link-webinar-join/, 'an unregistered member was offered the room');
  const past = webinar({ now: END + 3600000, registration: { registered: true, attended: 1 }, recordingHref: '/learning/courses/seed-basics/l9' });
  assert.match(past, /data-phase="past"/);
  assert.match(tagOf(past, 'link-webinar-recording'), /href="\/learning\/courses\/seed-basics\/l9"/);
  assert.doesNotMatch(past, /link-webinar-join/, 'the room is offered after the webinar ended');
  assert.match(flat(webinar({ now: END + 3600000, registration: null })), /Recording not available\./);
  assert.match(flat(webinar({ now: START - 3600000, webinar: { ...WEBINAR, status: 'cancelled' } })), /This webinar was cancelled\./);
  const full = linkOf(webinar({ now: START - 86400000, webinar: { ...WEBINAR, capacity: 12 }, onRegister: () => {} }), 'button-webinar-register');
  assert.equal(full.label, 'Full');
  assert.match(full.tag, /disabled=""/);
  const uncounted = flat(webinar({ now: START - 86400000, webinar: { ...WEBINAR, registered_count: null, capacity: null, host_name: null } }));
  assert.match(uncounted, /Host not recorded · capacity not recorded · registrations not recorded/);
  assert.doesNotMatch(uncounted, /\b0 registered/);
});

const EXERCISE = { uid: 'e1', title: 'Write your one-liner', instructions: 'Say what you do in **one** sentence.', submission_kind: 'text' };

test('ExercisePanel: not submitted, needs work, accepted, with the reviewer’s feedback', () => {
  const fresh = html(h(ExercisePanel, { status: 'ready', exercise: EXERCISE, submission: null }));
  assert.match(fresh, /<strong>one<\/strong>/);
  assert.match(fresh, /data-testid="exercise-not-submitted"/);
  assert.equal(linkOf(fresh, 'button-exercise-submit').label, 'Submit');
  assert.match(tagOf(fresh, 'button-exercise-submit'), /disabled=""/);
  assert.match(flat(fresh), /No review yet\./);
  const needsWork = {
    uid: 's1', body: 'We help founders raise.', status: 'needs_work', feedback: 'Name the buyer.', reviewer_name: 'Rae Reviewer',
    submitted_at: '2026-10-01 10:00:00', reviewed_at: '2026-10-02 10:00:00',
  };
  const work = html(h(ExercisePanel, { status: 'ready', exercise: EXERCISE, submission: needsWork, onSubmit: () => {} }));
  const out = flat(work);
  assert.match(out, /Needs work Submitted 1 Oct 2026 · reviewed 2 Oct 2026/);
  assert.match(out, /Rae Reviewer · 2 Oct 2026 Name the buyer\./);
  assert.match(work, />We help founders raise\.<\/textarea>/, 'a resubmission starts from the answer that needs work');
  assert.equal(linkOf(work, 'button-exercise-submit').label, 'Resubmit');
  const accepted = html(h(ExercisePanel, { status: 'ready', exercise: EXERCISE, submission: { ...needsWork, status: 'accepted' }, onSubmit: () => {} }));
  assert.match(accepted, /data-testid="exercise-accepted"/);
  assert.doesNotMatch(accepted, /form-exercise-answer/, 'an accepted answer offers a resubmit');
  const waiting = flat(html(h(ExercisePanel, { status: 'ready', exercise: EXERCISE, submission: { ...needsWork, status: 'submitted', feedback: null, reviewed_at: null } })));
  assert.match(waiting, /Submitted Submitted 1 Oct 2026/);
  assert.match(waiting, /No review yet\./);
});

const EXAM = { uid: 'x1', title: 'Seed basics check', intro: 'Ten minutes, two questions.', pass_mark_percent: 70, time_limit_minutes: 30, max_attempts: 3, reveal: 'score', question_count: 2 };
const ATTEMPT_START = '2026-10-06 10:00:00';
const ATTEMPT = {
  uid: 'a3', started_at: ATTEMPT_START,
  questions: [
    { uid: 'q2', position: 2, prompt: 'Which of these dilute the founders?', kind: 'multiple', options: ['A SAFE', 'A grant'] },
    { uid: 'q1', position: 1, prompt: 'What is a pre-money valuation?', kind: 'single', options: [{ key: 'a', label: 'The value before the round' }, { key: 'b', label: 'The value after it' }] },
  ],
};
/** `POST …/submit`'s attempt with its counts (D559), and the questions the page showed. */
const RESULT = {
  uid: 'a3', started_at: '2026-10-05 11:40:00', score_percent: 82, passed: true, timed_out: false, correct_count: 16, question_count: 20,
  submitted_at: '2026-10-05 12:00:00', answers_revealed: false, questions: [ATTEMPT.questions[1]],
};
const REVEALED = { ...RESULT, answers_revealed: true, answers: { q1: [1] }, correct: { q1: [0] } };

test('ExamFlow: intro, one question at a time against the clock, the result, answers only when revealed', () => {
  const intro = html(h(ExamFlow, { status: 'ready', exam: EXAM, attempts: [{ uid: 'a1', score_percent: 50, passed: 0, submitted_at: '2026-10-03 09:20:00' }] }));
  assert.match(intro, /data-step="intro"/);
  assert.match(flat(intro), /Questions 2 Time limit 30 min Pass mark 70% Attempts left 2/);
  assert.equal(linkOf(intro, 'button-exam-start').label, 'Start exam');
  assert.match(tagOf(intro, 'button-exam-start'), /disabled=""/);
  const spent = html(h(ExamFlow, { status: 'ready', exam: EXAM, attempts: [{}, {}, {}], onStart: () => {} }));
  assert.equal(linkOf(spent, 'button-exam-start').label, 'No attempts left');
  assert.match(tagOf(spent, 'button-exam-start'), /disabled=""/);
  const taking = html(h(ExamFlow, { status: 'ready', exam: EXAM, attempt: ATTEMPT, now: Date.parse('2026-10-06T10:06:12Z') }));
  assert.match(taking, /data-step="taking"/);
  assert.match(flat(taking), /Question 1 of 2 · 0 answered 23:48 What is a pre-money valuation\?/);
  assert.match(taking, /type="radio"/);
  assert.doesNotMatch(taking, /type="checkbox"|Which of these dilute/, 'more than one question on the screen');
  assert.match(html(h(ExamFlow, { status: 'ready', exam: EXAM, attempt: ATTEMPT, now: Date.parse('2026-10-06T10:31:00Z') })), /Time is up\./);
  const hidden = html(h(ExamFlow, { status: 'ready', exam: EXAM, result: REVEALED, attempts: [] }));
  assert.match(hidden, /data-step="result"/);
  assert.match(flat(hidden), /82% Pass Pass mark 70% · 16 of 20 correct · submitted 5 Oct 2026/);
  assert.match(hidden, /data-testid="exam-answers-hidden"/);
  assert.doesNotMatch(hidden, /The value before the round/, 'a correct answer is drawn on an exam that does not reveal them');
  const shown = html(h(ExamFlow, { status: 'ready', exam: { ...EXAM, reveal: 'score_and_answers' }, result: REVEALED, attempts: [] }));
  assert.match(flat(shown), /Your answer: The value after it Correct: The value before the round/);
  assert.match(text(h(ExamFlow, { status: 'ready', exam: EXAM, result: { ...RESULT, score_percent: 64, passed: 0 }, attempts: [] })), /64% Fail/);
});

test('MyLearning: three stores, three states, and one failure blanks nothing else', () => {
  const markup = html(h(MyLearning, {
    progress: { status: 'ready', data: {
      in_progress: [
        { subject_kind: 'course', subject_uid: 'c1', title: 'Seed basics', percent: 38, href: '/learning/courses/seed-basics' },
        { subject_kind: 'item', subject_uid: 'i9', item_kind: 'video', title: 'Cap tables', duration_seconds: 840, started_at: '2026-10-03 10:00:00' },
      ],
      completed: [{ subject_kind: 'course', subject_uid: 'c0', title: 'Orientation', completed_at: '2026-10-01 10:00:00' }],
    } },
    exercises: { status: 'unreadable', onRetry: () => {} },
    exams: { status: 'ready', data: [{ exam_uid: 'x1', title: 'Seed basics check', score_percent: 64, passed: 0 }] },
  }));
  const out = flat(markup);
  assert.match(out, /Courses in progress 1 Seed basics 38%/);
  assert.match(out, /Completed 1 Orientation 1 Oct 2026/);
  assert.match(out, /Videos watched 1 Cap tables 14 min · 3 Oct 2026/);
  const exercises = markup.slice(markup.indexOf('data-testid="my-exercises"'), markup.indexOf('data-testid="my-exams"'));
  assert.match(exercises, /learning-unreadable/);
  assert.match(out, /Exam results 1 Seed basics check 64% Fail/);
  assert.match(out, /Certificates Not recorded Certificates are not issued for courses yet\./);
  assert.match(html(h(MyLearning, { progress: { status: 'ready', data: { in_progress: [], completed: [] } } })), /learning-empty/);
  // Before any store merges: every part not recorded, nothing drawn as zero.
  const waiting = html(h(MyLearning));
  assert.equal((waiting.match(/data-testid="learning-not-live"/g) || []).length, 5);
  assert.doesNotMatch(flat(waiting), /\b0%/);
});

const CONTENTS = [
  { subject_kind: 'video', subject_uid: 'i1', title: 'What a seed round is', position: 1 },
  { subject_kind: 'exam', subject_uid: 'x1', title: 'Seed basics check', position: 3 },
  { subject_kind: 'exercise', subject_uid: 'e1', title: 'Write your one-liner', position: 2 },
  { subject_kind: 'course', subject_uid: 'c1', title: 'Seed basics', position: 4 },
];

// ProgramLearnersTable, LearnerRecord, ProgramsTable and ProgramDetail take D558's real shapes
// since stage 3; their rows are pinned in learning_programs_d558_ui.test.mjs.

test('StudioContentTable: its rows and filters', () => {
  const ROWS = [
    { kind: 'video', uid: 'v1', title: 'Cap tables', status: 'published', visibility: 'open', programs: [], updated_at: '2026-10-02' },
    { kind: 'course', uid: 'c1', title: 'Seed basics', status: 'draft', visibility: 'program', programs: [{ uid: 'p1', name: 'Nordics' }], updated_at: '2026-10-03' },
    { kind: 'exam', uid: 'x1', title: 'Seed basics check', status: 'archived', visibility: 'open', programs: null, updated_at: null },
  ];
  const studio = html(h(StudioContentTable, { status: 'ready', rows: ROWS }));
  assert.match(flat(studio.slice(studio.indexOf('studio-row-v1'))), /^[^]*?Video Cap tables Published Open None 2 Oct 2026/);
  assert.match(flat(studio.slice(studio.indexOf('studio-row-c1'))), /^[^]*?Course Seed basics Draft Program Nordics 3 Oct 2026/);
  assert.match(flat(studio.slice(studio.indexOf('studio-row-x1'))), /^[^]*?Exam Seed basics check Archived Open Not recorded not recorded/);
  assert.equal((studio.match(/data-testid="filter-studio-/g) || []).length, 5);
  const keep = (key) => ROWS.filter(STUDIO_FILTERS.find((f) => f.key === key).test).map((r) => r.uid);
  assert.deepEqual([keep('all'), keep('published'), keep('draft'), keep('archived'), keep('program')], [['v1', 'c1', 'x1'], ['v1'], ['c1'], ['x1'], ['c1']]);
});

test('every presentational component draws loading, empty, Not recorded and Unreadable', () => {
  const COMPONENTS = [
    [CourseOutline, { course: COURSE, modules: [] }],
    [LessonPlayer, { lesson: null, item: null }],
    [WebinarPanel, { webinar: null }],
    [ExercisePanel, { exercise: null }],
    [ExamFlow, { exam: null }],
    [ProgramLearnersTable, { contents: CONTENTS, learners: [] }],
    [LearnerRecord, { record: null }],
    [StudioContentTable, { rows: [] }],
    [ProgramsTable, { programs: [] }],
    [ProgramDetail, { program: null }],
  ];
  for (const [Component, emptyProps] of COMPONENTS) {
    const name = Component.name;
    assert.match(html(h(Component, { status: 'loading' })), /data-testid="learning-loading"/, `${name}: no loading state`);
    const unrecorded = html(h(Component, { status: 'unrecorded', reason: 'This store is not live yet.' }));
    assert.match(unrecorded, /data-testid="learning-not-live"/, `${name}: no Not recorded state`);
    assert.match(flat(unrecorded), /Not recorded This store is not live yet\./, `${name}: the line is not drawn`);
    const unreadable = html(h(Component, { status: 'unreadable', onRetry: () => {} }));
    assert.match(unreadable, /data-testid="learning-unreadable"/, `${name}: no Unreadable state`);
    assert.match(flat(unreadable), /could not be read\. This is not a claim/, `${name}: Unreadable says nothing about what it is not`);
    assert.match(html(h(Component, { status: 'ready', ...emptyProps })), /data-testid="learning-empty"/, `${name}: no empty state`);
  }
  // MyLearning's states are per store.
  assert.match(html(h(MyLearning, { progress: { status: 'loading' } })), /learning-loading/);
  assert.match(html(h(MyLearning, { exams: { status: 'unreadable' } })), /learning-unreadable/);
});

test('the pages use the app’s own styling: no font, no canvas colour, no new client method', () => {
  const dir = resolve(ROOT, 'frontend/src/pages/learning');
  const files = readdirSync(dir).filter((f) => /\.(jsx?|js)$/.test(f));
  assert.ok(files.length >= 15, `only ${files.length} files read`);
  for (const f of files) {
    const src = codeOnly(readFileSync(resolve(dir, f), 'utf8'));
    assert.doesNotMatch(src, /fontFamily|font-family|Space Grotesk|Roboto Mono|font-mono/, `${f} sets a font`);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, `${f} carries a canvas colour`);
    for (const m of src.matchAll(/style=\{\{([^}]*)\}\}/g)) assert.match(m[1], /^\s*width:/, `${f} styles something inline other than a bar's width`);
    // Four files call the client: the member reads, the studio's reads and writes, and, in stage 3,
    // the programs' (D558) and exercises and exams (D559).
    if (!['learningReads.js', 'studioActions.js', 'programReads.js', 'assessmentReads.js'].includes(f)) assert.doesNotMatch(src, /lib\/api(\/\w+(\.js)?)?'/, `${f} reads the client directly`);
  }
  // Each Learning client from its own module (D527), as research's pages import theirs:
  // `lib/api` re-exports them, but a named import through it is not what the guards read.
  const reads = codeOnly(read('frontend/src/pages/learning/learningReads.js'));
  assert.match(reads, /import \{ articles, publications, eventsPublic \} from '\.\.\/\.\.\/lib\/api';/);
  assert.match(reads, /import \{ learningApi \} from '\.\.\/\.\.\/lib\/api\/learning\.js';/);
  const studio = codeOnly(read('frontend/src/pages/learning/studioActions.js'));
  assert.match(studio, /import \{ adminLearningApi \} from '\.\.\/\.\.\/lib\/api\/adminLearning\.js';/);
  const programs = codeOnly(read('frontend/src/pages/learning/programReads.js'));
  const assessments = codeOnly(read('frontend/src/pages/learning/assessmentReads.js'));
  // No client method was added: every Learning method the folder calls is one the Learning modules declare.
  for (const [client, file, calls] of [
    ['learningApi', 'frontend/src/lib/api/learning.js', /\blearningApi\.(\w+)\(/g],
    ['adminLearningApi', 'frontend/src/lib/api/adminLearning.js', /\badminLearningApi\.(\w+)\(/g],
  ]) {
    assert.ok(existsSync(resolve(ROOT, file)), `${file} is gone`);
    const declared = read(file);
    const called = new Set([...(reads + studio + programs + assessments).matchAll(calls)].map((m) => m[1]));
    assert.ok(called.size > 0, `the folder calls no ${client} method`);
    for (const method of called) assert.ok(declared.includes(`  ${method}: (`), `${client}.${method} is not a method ${file} declares`);
  }
});

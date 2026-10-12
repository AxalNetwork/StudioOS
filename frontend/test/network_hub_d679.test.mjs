/**
 * D679 (#1553), part 1 — the public Network section's Resources hub, Articles
 * and Directory, built to the owner's canvas
 * `design/canvases/integrated/Axal VC Website.dc.html` (NETWORK SUB-NAV,
 * NETWORK HUB, ARTICLES, DIRECTORY).
 *
 * This pins:
 *   - every hub block reads its section's live list, shows at most the
 *     canvas's number of rows, links to its section, and says so in one
 *     sentence when the list is empty or fails;
 *   - no row, figure, filter or person from the canvas is typed into source:
 *     the canvas's directory names real people, and none of them ships;
 *   - the directory figures are D675's counts from `/api/public/stats`, each
 *     drawn only when it comes back as a positive number;
 *   - the article pills are the live sector taxonomy, and the directory pills
 *     are the entity types the live rows carry;
 *   - the directory preview draws only fields the public read exposes;
 *   - the Network sub-nav renders first on each of the three pages.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_hub_d679.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = {
  hub: 'frontend/src/pages/site/ResourcesPage.jsx',
  articles: 'frontend/src/pages/ArticlesPage.jsx',
  directory: 'frontend/src/pages/PublicDirectoryPage.jsx',
  lib: 'frontend/src/lib/siteResources.js',
  css: 'frontend/src/pages/site/network.css',
  decision: 'documentation/architecture/decisions/D679.md',
};

const apiMod = await import('../src/lib/api.js');
const lib = await import('../src/lib/siteResources.js');
const hub = await import('../src/pages/site/ResourcesPage.jsx');
const arts = await import('../src/pages/ArticlesPage.jsx');
const dir = await import('../src/pages/PublicDirectoryPage.jsx');

const render = (el, at = '/') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [at] }, el));
const count = (html, needle) => html.split(needle).length - 1;

// The canvas's sample people and companies, encoded so that this file does not
// carry them either.
const SAMPLES = [
  'RWxlbmEgVm9zcw==', 'U29maWEgTWFyY2hldHRp', 'R3VpbGxhdW1lIExhdXppZXI=', 'SmFtZXMgV2hpdGZpZWxk',
  'RGF2aWQgUmV5ZXM=', 'UHJpeWEgTWVub24=', 'VG9tIE9rYWZvcg==', 'SGFuYSBLYXVy', 'TGluIFpoYW5n',
  'SGFseWFyZCBTZWN1cml0eQ==', 'TG9vcFNlbnNl', 'UHJpY2VkIG9uIG5hcnJhdGl2ZQ==',
].map((b) => Buffer.from(b, 'base64').toString('utf8'));

/** Swap an api method for the length of one call. */
async function withStub(obj, key, fn, run) {
  const prev = obj[key];
  obj[key] = fn;
  try { return await run(); } finally { obj[key] = prev; }
}

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test('each hub block reads its section\'s live list, at the canvas\'s row count', async () => {
  assert.deepEqual(lib.HUB_LIMITS, { members: 5, events: 4, articles: 3, circles: 3, jobs: 4 });
  const calls = [];
  const cases = [
    ['members', apiMod.api, 'publicListPartners', (p) => { calls.push(['partners', p]); return Promise.resolve({ partners: many(9, (i) => ({ slug: `p${i}` })) }); }, 5],
    ['events', apiMod.eventsPublic, 'list', (p) => { calls.push(['events', p]); return Promise.resolve({ events: many(9, (i) => ({ id: i })) }); }, 4],
    ['articles', apiMod.articles, 'list', (p) => { calls.push(['articles', p]); return Promise.resolve({ items: many(9, (i) => ({ id: i })) }); }, 3],
    ['circles', apiMod.circlesPublic, 'list', (p) => { calls.push(['circles', p]); return Promise.resolve({ circles: many(9, (i) => ({ id: i })) }); }, 3],
    ['jobs', apiMod.jobsPublic, 'list', (p) => { calls.push(['jobs', p]); return Promise.resolve({ jobs: many(9, (i) => ({ id: i })) }); }, 4],
  ];
  for (const [block, obj, key, stub, n] of cases) {
    const got = await withStub(obj, key, stub, () => lib.HUB_LOADERS[block]());
    assert.equal(got.length, n, `${block} shows ${n} rows`);
    // A reply in the wrong shape is an empty list, never a crash or a stand-in.
    const bad = await withStub(obj, key, () => Promise.resolve({ nope: true }), () => lib.HUB_LOADERS[block]());
    assert.deepEqual(bad, [], `${block}: a reply without its list is empty`);
  }
  assert.deepEqual(calls.map(([k]) => k), ['partners', 'events', 'articles', 'circles', 'jobs'],
    'each block calls the read its own section page makes');
  assert.equal(calls.find(([k]) => k === 'events')[1].limit, 4, 'the events read asks for four');

  // A failed read is an empty list on the page: the hook catches into [].
  assert.match(code(read(FILES.lib)), /\.catch\(\(\) => \{ if \(alive\) setItems\(\[\]\); \}\)/);
  for (const k of ['members', 'events', 'articles', 'circles', 'jobs']) {
    assert.match(code(read(FILES.hub)), new RegExp(`useLiveList\\(HUB_LOADERS\\.${k}\\)`), `the hub mounts the ${k} read`);
  }
});

test('the hub draws its rows from the lists it is handed, links each block, and says when one is empty', () => {
  const loading = render(React.createElement(hub.ResourcesBody, { stats: null, members: null, events: null, articles: null, sectors: null, circles: null, jobs: null }));
  assert.equal(count(loading, 'Loading…'), 5, 'each block says it is loading, and draws no row');

  const empty = render(React.createElement(hub.ResourcesBody, { stats: null, members: [], events: [], articles: [], sectors: [], circles: [], jobs: [] }));
  for (const line of [
    'No one is listed in the directory yet.', 'Nothing is scheduled right now.', 'No articles are published yet.',
    'No circles are open yet.', 'No open roles right now.',
  ]) assert.ok(empty.includes(line), `the empty sentence "${line}" is drawn`);

  for (const [text, to] of [
    ['Browse all →', '/directory'], ['Calendar →', '/events'], ['All articles →', '/articles'],
    ['All circles →', '/circles'], ['All roles →', '/jobs'], ['Request directory access →', '/contact'],
  ]) assert.ok(empty.includes(`href="${to}" data-discover="true">${text}</a>`), `${text} links ${to}`);
  assert.match(empty, /Verified members only\./, 'the canvas\'s access line stays');

  const html = render(React.createElement(hub.ResourcesBody, {
    stats: null,
    members: [{ slug: 'row-one', name: 'Row One Partner', company: 'Rowco', headline: 'Formation counsel', email: 'leak@example.com', phone: '+1 555', geo: 'Nowhere' }],
    events: [{ id: 7, slug: 'ev-seven', title: 'Live event row', type: 'office_hours', starts_at: '2026-11-03T14:00:00Z', timezone: 'UTC' }],
    articles: [{ id: 3, slug: 'art-three', title: 'Live article row', sector: 'ai', read_minutes: 6, published_at: '2026-10-01T00:00:00Z' }],
    sectors: [{ key: 'ai', label: 'AI / Machine learning' }],
    circles: [{ id: 2, slug: 'c-two', name: 'Live circle row', type: 'founder', access: 'private', members: 8 }],
    jobs: [{ id: 4, slug: 'job-four', title: 'Live role row', startup_name: 'Rowco', remote: true }],
  }));
  for (const [text, to] of [
    ['Row One Partner', '/partners/row-one'], ['Live event row', '/events/ev-seven'], ['Live article row', '/articles/art-three'],
    ['Live circle row', '/circles'], ['Live role row', '/jobs/job-four'],
  ]) {
    assert.ok(html.includes(text), `${text} is drawn`);
    assert.ok(html.includes(`href="${to}"`), `${text} links ${to}`);
  }
  assert.match(html, /Rowco · Formation counsel/, 'the directory row\'s line is the read\'s company and headline');
  assert.match(html, /Operating partner/, 'the directory row carries its type');
  assert.match(html, /AI \/ Machine learning/, 'the article is named by the live taxonomy');
  assert.match(html, /Founder circles · 8 members/);
  assert.match(html, /Invite-only/);
  assert.match(html, /Rowco · Remote/);
  for (const leak of ['leak@example.com', '+1 555', 'Nowhere']) {
    assert.ok(!html.includes(leak), `the directory preview draws only what the public read exposes (${leak})`);
  }
});

test('no row, figure, filter or sample person from the canvas is typed into source', () => {
  const sources = Object.values(FILES).map((f) => [f, read(f)]);
  sources.push(['frontend/test/network_hub_d679.test.mjs', read('frontend/test/network_hub_d679.test.mjs')]);
  for (const [f, src] of sources) {
    for (const name of SAMPLES) assert.ok(!src.includes(name), `${f} names a canvas sample: ${name}`);
  }
  // The canvas's figures and its sample arrays, anywhere.
  for (const f of [FILES.hub, FILES.articles, FILES.directory, FILES.lib]) {
    const src = code(read(f));
    for (const literal of [/\b412\b/, /\b147\b/, /'86'/, /'23'/, /ALL_MEM|ALL_ART|dirStats\s*=|articleFilters\s*=|dirFilters\s*=/]) {
      assert.doesNotMatch(src, literal, `${f}: the canvas sample ${literal} must not ship`);
    }
  }
  // The canvas's article categories are examples; the pills are the live taxonomy.
  for (const f of [FILES.articles, FILES.hub, FILES.lib]) {
    for (const literal of [/'Underwriting'/, /'Cohort notes'/, /'Formation'/, /'Fund'/]) {
      assert.doesNotMatch(code(read(f)), literal, `${f}: the canvas category ${literal} must not ship`);
    }
  }
  // The canvas's directory filters have no live type behind them.
  for (const f of [FILES.directory, FILES.hub, FILES.lib]) {
    for (const literal of [/'Partners'/, /'LPs'/, /'Founders'/, /'Operators'/]) {
      assert.doesNotMatch(code(read(f)), literal, `${f}: the canvas filter ${literal} must not ship`);
    }
  }
});

test('the directory figures are the stats endpoint\'s counts, drawn only when present', () => {
  assert.deepEqual(lib.DIR_FIGURES.map((f) => [f.key, f.label]), [
    ['members_verified', 'Verified members'], ['countries', 'Countries'],
    ['lps_and_funds', 'LPs & funds'], ['operators_and_advisors', 'Operators & advisors'],
  ]);
  assert.deepEqual(lib.dirFigures(null), []);
  assert.deepEqual(lib.dirFigures({ partners: 40, users: 900 }), [], 'other counts are not directory figures');
  assert.deepEqual(
    lib.dirFigures({ members_verified: 0, countries: 'n/a', lps_and_funds: '12', operators_and_advisors: 30.4 }).map((f) => [f.key, f.value]),
    [['lps_and_funds', 12], ['operators_and_advisors', 30]],
    'a zero, a missing or a non-numeric count is not drawn',
  );
  assert.match(code(read(FILES.lib)), /fetch\('\/api\/public\/stats'/, 'the figures come from the stats endpoint');

  const none = render(React.createElement(hub.ResourcesBody, { stats: null, members: [], events: [], articles: [], sectors: [], circles: [], jobs: [] }));
  assert.doesNotMatch(none, /ax-res-figs/, 'no figure row before the stats answer');
  const some = render(React.createElement(hub.ResourcesBody, { stats: { countries: 14, members_verified: 0 }, members: [], events: [], articles: [], sectors: [], circles: [], jobs: [] }));
  assert.match(some, />14<\/span><span class="ax-res-fig-k">Countries</);
  assert.equal(count(some, 'class="ax-res-fig"'), 1, 'a zero count is not drawn on the hub');
  assert.doesNotMatch(some, /ax-res-fig-k">Verified members</);

  assert.equal(render(React.createElement(dir.DirectoryFigures, { stats: null })), '', 'the directory draws no empty figure cards');
  const four = render(React.createElement(dir.DirectoryFigures, { stats: { members_verified: 1200, countries: 31, lps_and_funds: 64, operators_and_advisors: 210 } }));
  assert.equal(count(four, 'class="ax-dir-fig"'), 4);
  assert.match(four, /1,200/);
  assert.ok(four.indexOf('Verified members') < four.indexOf('Operators &amp; advisors'), 'in the canvas order');
});

test('the article pills are the live sector taxonomy', () => {
  assert.deepEqual(lib.articleFilterOptions(null), [{ value: '', label: 'All' }]);
  assert.deepEqual(lib.articleFilterOptions([{ key: 'ai', label: 'AI / Machine learning' }, { key: 'frontier_sw' }, {}]), [
    { value: '', label: 'All' }, { value: 'ai', label: 'AI / Machine learning' }, { value: 'frontier_sw', label: 'frontier sw' },
  ]);
  const src = code(read(FILES.articles));
  assert.match(src, /api\.sectors\(\)/, 'the pills read GET /api/articles/sectors');
  assert.match(src, /articleFilterOptions\(sectors\)/);
  assert.match(src, /<FilterPills options=\{pills\} value=\{sector\} onChange=\{setSector\}/, 'a pill filters the list by sector');
  assert.match(src, /sector: sector \|\| undefined/, 'the chosen sector goes to the list read');

  // Before the taxonomy answers there is one pill, All — never a typed category.
  const html = render(React.createElement(arts.default), '/articles');
  const pills = html.slice(html.indexOf('aria-label="Article categories"'));
  assert.equal(count(pills.slice(0, pills.indexOf('</div>')), '<button'), 1);

  // The page keeps its own behaviour: search, the author filter, the featured strip, pagination.
  for (const keep of [/placeholder="Search articles…"/, /ROLE_FILTERS\.map/, /featured: 1/, /Page \{page \+ 1\} of \{totalPages\}/, /No articles yet\. Be the first to publish\./]) {
    assert.match(src, keep);
  }
});

test('an article card: category, date and read time, title, excerpt, author link, Read →', () => {
  const html = render(React.createElement(arts.ArticleCard, {
    a: { id: 9, slug: 'card-slug', title: 'Card title', excerpt: 'Card excerpt.', subtitle: 'Not this', author: 'Card Author', author_user_id: 77, read_minutes: 7, published_at: '2026-09-02T10:00:00Z' },
    category: 'Fintech',
  }));
  assert.match(html, /<span class="ax-chip">Fintech<\/span>/);
  assert.match(html, /Sep 2, 2026 · 7 min/);
  assert.match(html, /href="\/articles\/card-slug"[^>]*>Card title</);
  assert.match(html, /Card excerpt\./);
  assert.ok(!html.includes('Not this'), 'the excerpt wins over the subtitle');
  assert.match(html, />CA</, 'the author\'s initials');
  assert.match(html, /href="\/authors\/77"[^>]*>Card Author</, 'the author links to their profile');
  assert.match(html, /Read →/);
});

test('the directory pills are the entity types the live rows carry', () => {
  assert.deepEqual(lib.directoryTypeOptions([]), [{ value: '', label: 'All' }], 'no rows, no type pills');
  assert.deepEqual(lib.directoryTypeOptions([{ slug: 'a' }, { slug: 'b' }]),
    [{ value: '', label: 'All' }, { value: 'partners', label: 'Operating partners' }],
    'the partners read lists operating partners');
  assert.deepEqual(lib.directoryTypeOptions([{ slug: 'a' }, { slug: 'b', type: 'advisor' }]).map((o) => o.value), ['', 'partners', 'advisor'],
    'a row that carries its own type is filed under it');

  const src = code(read(FILES.directory));
  assert.match(src, /api\.publicListPartners\(params\)/, 'the rows are the public directory read');
  assert.match(src, /directoryTypeOptions\(partners\)/);
  assert.match(src, /directoryTypeOf\(p\) === type/, 'a pill filters the rows by type');
  // The page keeps its own behaviour: search, the detailed filters, verified-only, the profile links.
  for (const keep of [/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) apply\(\); \}\}/, /CATEGORIES\.map/, /verified_only/, /KYB-verified partners only/, /Request directory access →/]) {
    assert.match(src, keep);
  }

  const row = render(React.createElement('ul', null, React.createElement(dir.PartnerCard, {
    p: { slug: 'acme-legal', name: 'Acme Legal', company: 'Acme', headline: 'Formation counsel', categories: ['legal'], kyb_verified: true, featured: true },
  })));
  assert.match(row, />AL</);
  assert.match(row, /Acme Legal/);
  assert.match(row, /Operating partner/);
  assert.match(row, /Acme · Formation counsel · legal/);
  assert.match(row, />Verified</, 'a KYB-verified partner is marked');
  assert.match(row, />Featured</);
  assert.match(row, /href="\/partners\/acme-legal"[^>]*>View profile</, 'the row links the partner\'s profile');
  const plain = render(React.createElement('ul', null, React.createElement(dir.PartnerCard, { p: { slug: 'x', name: 'X Co' } })));
  assert.doesNotMatch(plain, />Verified</, 'an unverified partner is not marked');
});

test('the Network sub-nav renders first on each page', () => {
  for (const [Page, at, h1] of [[hub.default, '/resources', 'Resources'], [arts.default, '/articles', 'Articles'], [dir.default, '/directory', 'Directory']]) {
    const html = render(React.createElement(Page), at);
    const main = html.slice(html.indexOf('<main'));
    assert.equal(count(html, '<nav class="ax-subnav" aria-label="Network">'), 1, `${at} draws the sub-nav once`);
    assert.ok(main.indexOf('class="ax-subnav"') > -1 && main.indexOf('class="ax-subnav"') < main.indexOf('<h1'), `${at}: the sub-nav sits above the page's heading`);
    assert.match(main, new RegExp(`<h1[^>]*>${h1}</h1>`));
  }
  for (const f of [FILES.hub, FILES.articles, FILES.directory]) {
    assert.match(read(f), /import NetworkSubNav from '[./]+\/components\/site\/NetworkSubNav'/, `${f} uses the site's sub-nav`);
    assert.match(read(f), /<SitePage title=/, `${f} renders in the site frame`);
  }
});

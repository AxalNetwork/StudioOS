/**
 * D593 — Markets for founders and investors, to the re-exported canvas
 * "Pages · Research Market Reading" (boards M0–M3), with the partner firm's
 * Market reading kept as drawn.
 *
 *   M1  `/research/markets`: every tracked sector the Worker names is a group
 *       with its own "Open sector →" link — a sector no market maps to says so —
 *       and the markets no sector claims sit last, under "Not mapped yet".
 *   M2  the fallback page for an unmapped market sits in the Research shell.
 *   M3  `/research/geographies/:code` sits in the Research shell: crumb
 *       Research ‹ Geographies ‹ the country, Geographies the current pill.
 *
 * And a first market reading can be recorded again. Nothing has mounted
 * `MarketZone`, which held the only "Record a reading" form, since the
 * directory replaced it; the form is now on the directory's readings card.
 *
 * Every test here failed on the code before D593, and each was mutation-checked
 * by undoing the behaviour it names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

// Namespaces, so an export that does not exist yet fails its own test only.
import * as directory from '../src/pages/research/MarketDirectoryZone.jsx';
import * as geography from '../src/pages/research/GeographyProfile.jsx';
import { PARTNER_ZONE_ACTIONS, partnerZoneActions } from '../src/workspaces/partnerZoneActions.js';
import { ADVISOR_ZONE_ACTIONS } from '../src/workspaces/advisorZoneActions.js';
import { RESEARCH_STORE_GAPS } from '../src/workspaces/noStoreCopy.js';
import researchBoard from '../src/workspaces/boards/research.js';
import { unsuppliedHandlers } from '../../scripts/check-zone-handlers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const html = (el) => at('/research/markets', el);

/** What a reader sees, each tag read as a space. A character scan, as `_renderedText.mjs` explains. */
function words(markup) {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Where each "Open sector →" link goes, in page order. */
const opens = (markup) => [...markup.matchAll(/href="(\/research\/markets\/sector\/[^"]+)"[^>]*>Open sector/g)].map((m) => m[1]);

const ready = (data) => ({ status: 'ready', data });
const loading = { status: 'loading', data: null };
const unreadable = { status: 'unreadable', data: null };

const MARKETS = {
  total: 3,
  items: [
    { slug: 'fintech', name: 'FinTech', mi_sector: 'Fintech / DeFi', company_count: 3, supplied_count: 900, as_of: '2026-09-30' },
    { slug: 'payments', name: 'Payments', mi_sector: 'Fintech / DeFi', company_count: 0, supplied_count: 10, as_of: '2026-09-30' },
    { slug: 'fashion', name: 'Fashion', mi_sector: null, company_count: 0, supplied_count: 50, as_of: '2026-09-30' },
  ],
};

// `GET /api/research/sectors` as the Worker answers it. Two have no market.
const SECTORS = {
  total: 3,
  items: [
    { name: 'Agentic B2B', slug: 'agentic-b2b', company_count: 0, fund_count: 0 },
    { name: 'Fintech / DeFi', slug: 'fintech-defi', company_count: 12, fund_count: 40 },
    { name: 'Quantum Infrastructure', slug: 'quantum-infrastructure', company_count: 0, fund_count: 3 },
  ],
};

const MD = MARKETS.items;

// ---- M1: the markets index ---------------------------------------------------

test('M1: a sector group opens /research/markets/sector/<slug>; the unmapped group opens nothing', () => {
  const markup = html(h(directory.PrivatePanel, { markets: ready(MARKETS) }));
  assert.deepEqual(opens(markup), ['/research/markets/sector/fintech-defi']);
  assert.match(markup, /Open sector<span class="sr-only"> Fintech \/ DeFi<\/span> →/,
    'each link names its sector to a screen reader');
  // The note that the link waited on #1139 is gone with the wait.
  assert.doesNotMatch(read('frontend/src/pages/research/MarketDirectoryZone.jsx'), /the link lands with it/);
});

test('M1: every tracked sector the Worker names is a group; one with no market says so and still opens', () => {
  const markup = html(h(directory.PrivatePanel, { markets: ready(MARKETS), sectors: ready(SECTORS) }));
  const t = words(markup);
  assert.match(t, /Fintech \/ DeFi 2 markets · 910 companies/);
  assert.match(t, /Agentic B2B No market is mapped to this sector yet Open sector Agentic B2B →/);
  assert.match(t, /Quantum Infrastructure No market is mapped to this sector yet Open sector Quantum Infrastructure →/);
  assert.deepEqual(opens(markup), [
    '/research/markets/sector/fintech-defi',
    '/research/markets/sector/agentic-b2b',
    '/research/markets/sector/quantum-infrastructure',
  ]);
  // Sectors with markets, then sectors without, then the unmapped markets.
  assert.ok(t.indexOf('Fintech / DeFi 2 markets') < t.indexOf('Agentic B2B No market'));
  assert.ok(t.indexOf('Quantum Infrastructure No market') < t.indexOf('Not mapped yet'));
});

test('M1: "no market is mapped" is said only over the whole list, and a failed sector read says so', () => {
  assert.deepEqual(directory.groupMarkets(MD, SECTORS.items).map((g) => [g.name, g.slug, g.markets.length]), [
    ['Fintech / DeFi', 'fintech-defi', 2],
    ['Agentic B2B', 'agentic-b2b', 0],
    ['Quantum Infrastructure', 'quantum-infrastructure', 0],
    ['Not mapped yet', null, 1],
  ]);
  // A read that held fewer markets than it counted cannot say a sector has none.
  const partial = words(html(h(directory.PrivatePanel, { markets: ready({ ...MARKETS, total: 90 }), sectors: ready(SECTORS) })));
  assert.doesNotMatch(partial, /No market is mapped/);
  assert.match(partial, /Fintech \/ DeFi 2 markets/);
  // A failed read of the sectors is not "no market", and it leaves the groups the markets name.
  const failed = words(html(h(directory.PrivatePanel, { markets: ready(MARKETS), sectors: unreadable })));
  assert.match(failed, /The tracked sectors could not be read\. The groups below are only the sectors a market maps to/);
  assert.doesNotMatch(failed, /No market is mapped/);
  assert.match(failed, /Fintech \/ DeFi 2 markets · 910 companies/);
  // A 404 on the list route has not said there are no sectors either.
  assert.match(words(html(h(directory.PrivatePanel, { markets: ready(MARKETS), sectors: { status: 'not_found', data: null } }))),
    /The tracked sectors could not be read/);
  assert.match(words(html(h(directory.PrivatePanel, { markets: ready(MARKETS), sectors: loading }))), /Loading the tracked sectors/);
});

test('M1: the tracked sectors are the Worker\'s list, read by the mounted page, never written in it', () => {
  const src = codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx'));
  assert.match(src, /useRead\(\(\) => researchSectorsApi\.list\(\)\)/);
  assert.match(src, /<PrivatePanel markets=\{\{ \.\.\.markets, reload: reloadMarkets \}\} sectors=\{\{ \.\.\.sectors, reload: reloadSectors \}\} \/>/);
  for (const name of ['AI Infrastructure', 'Agentic B2B', 'Quantum Infrastructure', 'Vertical SaaS', 'Climate Intelligence']) {
    assert.ok(!src.includes(name), `the page writes the sector "${name}" itself`);
  }
});

test('M1: the markets no sector claims are "Not mapped yet"', () => {
  assert.equal(directory.UNMAPPED_LABEL, 'Not mapped yet');
  const t = words(html(h(directory.PrivatePanel, { markets: ready(MARKETS) })));
  assert.match(t, /Not mapped yet 1 markets · no index applies/);
  assert.doesNotMatch(t, /Not mapped to a tracked sector/);
});

// ---- M2, M3: the detail pages sit in the Research shell ---------------------

const COUNTRY = {
  item: { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  totals: { companies: 300, funds: 2032, signals: 10 },
  as_of: { companies: '2026-09-30', funds: '2026-09-29', signals: '2026-10-02 00:00:00' },
  company_count: 2,
  companies_by_label: [{ label: 'bank', count: 1 }],
  companies_without_label: 1,
  companies: [{ uid: 'c1', name: 'Alpha Bank', sector: 'bank', founded_year: 2001, employee_count: null, last_round: null }],
  fund_count: 0,
  fund_aggregates: { count: 0, with_size: 0, with_vintage: 0, with_focus: 0, no_focus: 0, size_not_recorded: 0, size_bands: [], focus_keywords: [], as_of: null },
  funds: [],
  signals: [],
  demand: { status: 'not_recorded', reason: 'Demand data is global only.' },
};

test('M3: one country renders in the Research shell — crumb, title and pills — and keeps its body', () => {
  assert.equal(typeof geography.GeographyPage, 'function', 'no shell-wrapped country page');
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const markup = at('/research/geographies/GB', h(geography.GeographyPage, { geo: ready(COUNTRY), code: 'GB', role, reload: () => {} }));
    const t = words(markup);
    assert.match(t, /^Research ‹ Geographies ‹ United Kingdom United Kingdom ANALYTICS/, role);
    assert.match(markup, /data-testid="link-zone-geographies" aria-current="page"/, `${role}: Geographies is the current pill`);
    assert.match(markup, /data-testid="link-zone-markets"/, `${role}: the pills are on the row`);
    assert.match(markup, /data-testid="geography-profile"/);
    assert.match(t, /Directory companies 2 of 300/, `${role}: the body is the page's own`);
  }
  // The route renders the wrapped page, not the bare body.
  assert.match(codeOnly(read('frontend/src/pages/research/GeographyProfile.jsx')),
    /export default function GeographyProfile[\s\S]*return <GeographyPage geo=\{geo\} code=\{upper\} role=\{role\} reload=\{reload\} \/>;/);
});

test('M3: not found and unreadable stay the page\'s own states, inside the shell', () => {
  const nf = words(at('/research/geographies/ZZ', h(geography.GeographyPage, { geo: { status: 'not_found', data: null }, code: 'ZZ', reload: () => {} })));
  assert.match(nf, /^Research ‹ Geographies ‹ Country Country/);
  assert.match(nf, /No country has the code ZZ/);
  const bad = words(at('/research/geographies/GB', h(geography.GeographyPage, { geo: unreadable, code: 'GB', reload: () => {} })));
  assert.match(bad, /^Research ‹ Geographies ‹ Country/);
  assert.match(bad, /The country GB could not be read/);
  assert.doesNotMatch(bad, /No country has/, 'a failed read is not "no such country"');
});

test('M2: an unmapped market\'s fallback page sits in the Research shell, both when found and when not', () => {
  // `MarketSectorProfile.jsx` imports a JSON bundle Node cannot load without an
  // import attribute, so this reads the source rather than rendering it.
  const src = codeOnly(read('frontend/src/pages/research/MarketSectorProfile.jsx'));
  const legacy = src.slice(src.indexOf('function LegacyMarketProfile'), src.indexOf('export default function MarketSectorProfile'));
  assert.match(legacy, /if \(!sector\) return <WorkspaceShell role=\{role\} title="Market" activeSlug="markets">/);
  assert.match(legacy, /return <WorkspaceShell role=\{role\} title=\{sector\.name\} activeSlug="markets"><div data-testid="market-sector-profile"/);
});

// ---- Recording a reading ------------------------------------------------------

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const LIST = {
  items: [
    { uid: 'r-old', offering_uid: 'o-brand', metric: 'Brand refresh', ran_at: daysAgo(120), comparable_count: 7 },
    { uid: null, offering_uid: 'o-retainer', metric: 'Retainer', ran_at: null, comparable_count: null },
    { uid: 'r-new', offering_uid: null, metric: 'Fractional seat', ran_at: daysAgo(10), comparable_count: 4 },
  ],
};
const noop = () => {};
const RECORD = { form: null, opened: 0, busy: false, note: null, onOpen: noop, onChange: noop, onCancel: noop, onSave: noop };

test('the readings card offers "Record a reading" once the list is read, and the form asks what the Worker requires', () => {
  assert.match(words(html(h(directory.Readings, { readings: ready(LIST), record: RECORD }))), /Your market readings Record a reading →/);
  // An empty list has been read too: a first reading needs no service line.
  assert.match(words(html(h(directory.Readings, { readings: ready({ items: [] }), record: RECORD }))), /Record a reading →/);
  // Not before the list is read, and not over a failed read.
  assert.doesNotMatch(words(html(h(directory.Readings, { readings: loading, record: RECORD }))), /Record a reading/);
  assert.doesNotMatch(words(html(h(directory.Readings, { readings: unreadable, record: RECORD }))), /Record a reading/);

  const form = directory.readingForm(null, '2026-10-06');
  const open = html(h(directory.Readings, { readings: ready(LIST), record: { ...RECORD, form } }));
  for (const field of ['Service line', 'What it prices', 'Low (USD)', 'High (USD)', 'Comparables', 'Run date']) {
    assert.ok(open.includes(`aria-label="${field}"`), field);
  }
  assert.match(open, /<option value="o-brand">Brand refresh<\/option>/);
  assert.match(open, /<option value="o-retainer">Retainer<\/option>/, 'a service line never read is offered');
  assert.match(open, /value="2026-10-06"/, 'the run date starts at today');
  assert.match(words(open), /How many engagements the range came from\. Refused if 0\. Record this reading/);
});

test('a form the Worker would refuse is refused first, in the reading page\'s words', () => {
  const ok = { offering_uid: '', metric: 'Design system build', low: '38,000', high: '$62,000', n: '11', ran_at: '2026-10-01' };
  assert.deepEqual(directory.readingPayload(ok), { payload: {
    metric: 'Design system build', range_low_cents: 3800000, range_high_cents: 6200000, comparable_count: 11, ran_at: '2026-10-01',
  } });
  assert.equal(directory.readingPayload({ ...ok, offering_uid: 'o-brand', metric: 'Brand refresh' }).payload.offering_uid, 'o-brand');
  assert.ok(directory.readingPayload({ ...ok, high: '38000' }).payload, 'low equal to high reads forward');
  assert.equal(directory.readingPayload({ ...ok, low: '62000', high: '38000' }).error,
    'High is below low. Nothing is saved until the range reads forward.');
  assert.equal(directory.readingPayload({ ...ok, n: '0' }).error, 'How many engagements the range came from. Refused if 0.');
  assert.equal(directory.readingPayload({ ...ok, ran_at: '' }).error, 'A reading needs the date you ran it.');
  assert.equal(directory.readingPayload({ ...ok, metric: '  ' }).error, 'Name what the range prices.');
  assert.equal(directory.readingPayload({ ...ok, low: '' }).error, 'Enter the low and the high.');
});

test('a save opens the new reading at /research/markets/<uid>; a refused form sends nothing', async () => {
  const sent = [];
  const went = [];
  const go = (to) => went.push(to);
  const create = async (body) => { sent.push(body); return { item: { uid: 'new uid/1' } }; };
  const saved = await directory.submitReading(
    { offering_uid: 'o-retainer', metric: 'Retainer', low: '4000', high: '6000', n: '5', ran_at: '2026-10-06' }, { create, go });
  assert.deepEqual(went, ['/research/markets/new%20uid%2F1']);
  assert.equal(saved.opened, '/research/markets/new%20uid%2F1');
  assert.equal(sent[0].offering_uid, 'o-retainer');

  const refused = await directory.submitReading({ metric: 'X', low: '9', high: '1', n: '1', ran_at: '2026-10-06' }, { create, go });
  assert.equal(sent.length, 1, 'nothing is sent for a range that runs backwards');
  assert.equal(refused.ok, false);

  const notTheirs = await directory.submitReading({ offering_uid: 'o-x', metric: 'X', low: '1', high: '9', n: '1', ran_at: '2026-10-06' }, {
    create: async () => { throw Object.assign(new Error('not_found'), { status: 404, code: 'not_found' }); }, go,
  });
  assert.equal(notTheirs.text, 'That service line is not in your catalog, so nothing was saved.');
  assert.equal(went.length, 1, 'a refusal opens nothing');

  // The mounted page hands it the real call and the router's navigate.
  const src = codeOnly(read('frontend/src/pages/research/MarketDirectoryZone.jsx'));
  assert.match(src, /submitReading\(form, \{ create: api\.research\.marketReadingCreate, go: navigate \}\)/);
  assert.match(src, /<Readings\s+readings=\{\{ \.\.\.readings, reload: reloadReadings \}\}\s+record=\{\{/);
});

test('each reading shows its run date, its age and its band', () => {
  const t = words(html(h(directory.Readings, { readings: ready(LIST) })));
  assert.ok(t.includes(`Brand refresh run ${LIST.items[0].ran_at} · 120 d old Stale`), t);
  assert.ok(t.includes(`Fractional seat run ${LIST.items[2].ran_at} · 10 d old Current`), t);
  assert.doesNotMatch(t, /Retainer/, 'a service line never read is not a reading');
});

test('the partner row\'s Re-run stale opens the form on the stale reading; Attach to proposal stays unbuilt', () => {
  const ops = PARTNER_ZONE_ACTIONS['research/markets'];
  assert.deepEqual(ops.find((o) => o.label === 'Re-run stale'), { label: 'Re-run stale', kind: 'handler', handler: 'reRunStale' });
  assert.ok(ops.find((o) => o.label === 'Attach to proposal').unbuilt, 'nothing on this page attaches a reading');
  // The advisor's AR3 op re-runs sourced sector figures, which no store holds.
  assert.ok(ADVISOR_ZONE_ACTIONS['research/markets'].find((o) => o.label === 'Re-run stale').unbuilt);

  // Stale first, then a service line never read, else nothing.
  assert.equal(directory.nextToRerun(LIST.items).uid, 'r-old');
  assert.equal(directory.nextToRerun(LIST.items.slice(1)).offering_uid, 'o-retainer');
  assert.equal(directory.nextToRerun([LIST.items[2]]), null);
  // The re-run keeps what it prices and its count, and blanks the dollars.
  assert.deepEqual(directory.readingForm(directory.nextToRerun(LIST.items), '2026-10-06'),
    { offering_uid: 'o-brand', metric: 'Brand refresh', n: '7', low: '', high: '', ran_at: '2026-10-06' });

  let clicked = 0;
  const row = partnerZoneActions('research/markets', {
    handlers: { reRunStale: { onClick: () => { clicked += 1; }, disabled: false, title: 'Record a fresh reading for Brand refresh.' } },
    view: { rows: [], header: [], cells: () => [] },
  });
  const rerun = row.find((a) => a.label === 'Re-run stale');
  assert.ok(rerun && !rerun.disabled && typeof rerun.onClick === 'function', 'the op is live');
  rerun.onClick();
  assert.equal(clicked, 1);
  // The page that renders the zone supplies it, through the workspace.
  assert.deepEqual(unsuppliedHandlers().filter((b) => b.zone === 'research/markets'), []);
  assert.match(codeOnly(read('frontend/src/workspaces/ResearchWorkspace.jsx')),
    /zoneActions=\{\(rows, handlers\) => zoneActionsFor\(role, 'research\/markets', \{ handlers, view:/);
});

test('copy that described the page without its form or its directory says what is there', () => {
  const card = researchBoard('partner', { research: { documents: noop } }).sections.find((s) => s.slug === 'markets');
  assert.match(card.blurb, /each with its run date and age, beside the taxonomy’s markets by tracked sector/);
  assert.doesNotMatch(read('frontend/src/workspaces/boards/research.js'), /the zone this card opens is `MarketZone`/);
  const gap = RESEARCH_STORE_GAPS.markets;
  assert.match(gap.why, /the taxonomy’s markets by tracked sector and your comparable readings — ranges you record here/);
  assert.doesNotMatch(gap.why, /What this page holds instead is comparable readings/);
  assert.match(read('frontend/src/workspaces/ResearchWorkspace.jsx'),
    /markets: 'Comparable ranges you entered, each with its run date and age, beside the taxonomy’s markets by tracked sector\.'/);
});

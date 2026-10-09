/**
 * D661 (#1474) — the cycle overview and module page components, against
 * fixtures shaped exactly like #1469's shared read (D656): the card states,
 * the chart specs, the figures, the records table, and that nothing is
 * mounted on a live route yet.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cycle_pages_d661.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  CARD_STATES, CHART_KINDS, CYCLES, MIN_POINTS, cardView, cellView, cycleOf, cycleTabs, drawable, drawableSeries,
  figureDelta, figureValue, lineSegments, moduleQuery, pageButtons, recordsCount, safeHref, share, sparkDrawable,
} from '../src/pages/cycles/cycleModel.js';
import CycleOverview, { CycleCard, FigureTile } from '../src/pages/cycles/CycleOverview.jsx';
import CycleModulePage, { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { Chart } from '../src/pages/cycles/CycleCharts.jsx';
import { MODULES, OVERVIEWS, card, figure, records, slugOf } from './_cycle_fixtures.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/validate') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const kinds = (out) => [...out.matchAll(/data-chart="([a-z]+)"/g)].map((m) => m[1]);

// ------------------------------------------------------------------ the rules

test('the four cycles, each with the canvas question, outcome and primary action', () => {
  assert.deepEqual(Object.keys(CYCLES), ['validate', 'build', 'raise', 'grow']);
  assert.deepEqual(Object.values(CYCLES).map((c) => c.action), ['Record a session', 'Connect a tool', 'Call for Capital', 'Share an update']);
  assert.equal(cycleOf('Raise').question, 'What resources does this venture need?');
  assert.equal(cycleOf('nope'), null);
  assert.equal(Object.values(MODULES).flat().length, 26, 'the fixtures carry all 26 modules');
});

test('card states: the five from D656, an unknown state and an ok card with nothing to draw are unreadable', () => {
  assert.deepEqual(CARD_STATES, ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable']);
  assert.equal(cardView(null).state, 'loading');
  assert.deepEqual(cardView({ state: 'empty', reason: 'No interviews yet.' }), { state: 'empty', reason: 'No interviews yet.' });
  assert.deepEqual(cardView({ state: 'not_recorded', reason: null }), { state: 'not_recorded', reason: 'Not recorded.' });
  assert.equal(cardView({ state: 'too_little' }).reason, 'Too little data to draw a line yet.');
  assert.equal(cardView({ state: 'mystery' }).state, 'unreadable', 'a state the page does not know is not drawn as fine');
  assert.deepEqual(cardView({ state: 'ok', series: [{ kind: 'line', values: [1, 2] }] }), { state: 'unreadable', reason: 'This card came back with nothing to draw.' });
  assert.equal(cardView({ state: 'ok', series: [{ kind: 'pie', values: [1] }, { kind: 'big', value: '5' }] }).charts.length, 1, 'an unknown kind is skipped, the rest drawn');
});

test('chart specs: every kind is drawable with data, and none is drawn from nothing', () => {
  assert.equal(CHART_KINDS.length, 14);
  const fixtureKinds = new Set(Object.values(OVERVIEWS).flatMap((o) => o.cards.flatMap((c) => c.series.map((s) => s.kind))));
  assert.deepEqual([...fixtureKinds].sort(), [...CHART_KINDS].sort(), 'the fixtures exercise every kind');
  for (const o of Object.values(OVERVIEWS)) for (const c of o.cards) for (const s of c.series) assert.ok(drawable(s), `${s.kind} in ${c.name}`);
  assert.equal(MIN_POINTS, 3);
  assert.equal(drawable({ kind: 'line', values: [4, 5] }), false, 'two points draw no line');
  assert.equal(drawable({ kind: 'line', values: [4, null, 5, 6] }), true);
  assert.equal(drawable({ kind: 'line', values: [4, null, null, 6] }), false, 'missing points are not points');
  assert.equal(drawable({ kind: 'hbar', items: [{ label: 'a', value: null }] }), false);
  assert.equal(drawable({ kind: 'vbars', values: [0, 0] }), false, 'all zeros draw no bars');
  assert.equal(drawable({ kind: 'funnel', steps: [{ label: 'a', value: 0 }] }), false);
  assert.equal(drawable({ kind: 'timeline', steps: [{ label: 'a' }] }), false);
  assert.equal(drawable({ kind: 'big', value: '' }), false);
  assert.deepEqual(drawableSeries('nope'), []);
  assert.equal(share(5, 10, 300), 150);
  assert.equal(share(null, 10, 300, 6), 0, 'a missing value draws nothing, not the minimum');
  assert.equal(share(1, 1000, 300, 6), 6);
});

test('a line breaks where a value is missing: a missing month is not a zero', () => {
  assert.deepEqual(lineSegments([1, 2, null, 3, 4], { x0: 0, width: 40, y0: 10, height: 10, max: 4 }), [['0,7.5', '10,5'], ['30,2.5', '40,0']]);
  assert.deepEqual(lineSegments([5]), []);
  assert.deepEqual(lineSegments([0, 0, 0]), []);
});

test('figures: units, the pair, null as Not recorded, the 30-day change, and a sparkline only through three points', () => {
  assert.equal(figureValue(figure('k', 'MRR', 38400, 'usd')), '$38.4k');
  assert.equal(figureValue(figure('k', 'Raised', 1_500_000, 'usd')), '$1.5M');
  assert.equal(figureValue(figure('k', 'Burn', 9500, 'usd')), '$9,500');
  assert.equal(figureValue(figure('k', 'NRR', 104, 'pct')), '104%');
  assert.equal(figureValue(figure('k', 'Score', 62, 'score')), '62 / 100');
  assert.equal(figureValue(figure('k', 'Done', [11, 18], 'of')), '11 of 18');
  assert.equal(figureValue(figure('k', 'Interviews', 0, 'count')), '0', 'a recorded zero is a zero');
  assert.equal(figureValue(figure('k', 'Churn', null, 'pct')), null);
  assert.equal(figureValue(figure('k', 'MRR', 5, 'usd', { state: 'unreadable' })), null, 'an unreadable source shows no stale number');
  assert.equal(figureDelta(figure('k', 'x', 1, 'count', { delta_30d: 4 })), '▲ 4 in 30 days');
  assert.equal(figureDelta(figure('k', 'x', 1, 'count', { delta_30d: -1 })), '▼ 1 in 30 days');
  assert.equal(figureDelta(figure('k', 'x', 1, 'usd', { delta_30d: 150_000 })), '▲ $150k in 30 days');
  assert.equal(figureDelta(figure('k', 'x', 1, 'pct', { delta_30d: 2 })), '▲ 2 pts in 30 days');
  assert.equal(figureDelta(figure('k', 'x', 1, 'count', { delta_30d: 0 })), 'no change in 30 days');
  assert.equal(figureDelta(figure('k', 'x', 1, 'count', { delta_30d: null })), null);
  assert.equal(sparkDrawable([1, 2]), false);
  assert.equal(sparkDrawable([1, null, 2, 3]), true);
});

test('the module read query, the count, the pages, the cells and the links a read may carry', () => {
  assert.equal(moduleQuery({ project: 7, q: ' acme ', filter: { status: 'open', fit: '' }, sort: 'name', page: 2 }), '?project=7&q=acme&filter=status%3Aopen&sort=name&page=2');
  assert.equal(moduleQuery({}), '');
  assert.deepEqual(recordsCount({ total: 52, page: 2, page_size: 25, rows: new Array(25) }), { label: '26–50 of 52', page: 2, pages: 3, size: 25 });
  assert.equal(recordsCount({ total: 0, rows: [] }).label, '0 of 0');
  assert.equal(recordsCount({ total: null, rows: [1, 2] }).label, '2 shown · total not recorded', 'an unknown total is not a guess');
  assert.deepEqual(pageButtons(1, 3), [1, 2, 3]);
  assert.deepEqual(pageButtons(6, 12), [1, '…', 4, 5, 6, 7, 8, '…', 12]);
  assert.deepEqual(cellView(null), { text: 'Not recorded', nr: true });
  assert.deepEqual(cellView(''), { text: 'Not recorded', nr: true });
  assert.deepEqual(cellView(0), { text: '0' }, 'a recorded zero is shown');
  assert.deepEqual(cellView({ text: 'Done', tone: 'ok', href: '/x' }), { text: 'Done', tone: 'ok', href: '/x' });
  assert.equal(cellView({ text: 'x', tone: 'purple' }).tone, null, 'an unknown tone is not a class');
  assert.equal(safeHref('/validate/x'), '/validate/x');
  for (const bad of ['//evil.test', 'https://evil.test', 'javascript:alert(1)', 'validate', null]) assert.equal(safeHref(bad), null, String(bad));
  assert.deepEqual(cycleTabs('build', [{ slug: 'founding-team', name: 'Founding team' }], 'founding-team').map((t) => [t.name, t.href, t.active]),
    [['Overview', '/build', false], ['Founding team', '/build/founding-team', true]]);
});

// ------------------------------------------------------------------ the screens

test('every overview: question, outcome, action, four figures and one card per module, in the read order', () => {
  for (const [cycle, names] of Object.entries(MODULES)) {
    const out = html(h(CycleOverview, { cycle, data: OVERVIEWS[cycle], action: { href: `/${cycle}/act` } }), `/${cycle}`);
    const t = text(out);
    assert.ok(t.includes(CYCLES[cycle].question), cycle);
    assert.ok(t.includes(CYCLES[cycle].outcome), cycle);
    assert.match(out, new RegExp(`data-testid="cycle-action"[^>]*>${CYCLES[cycle].action}<`));
    assert.equal((out.match(/data-testid="cycle-figure-/g) || []).length, 4);
    const order = [...out.matchAll(/data-testid="cycle-card-([a-z0-9-]+)" data-state="ok"/g)].map((m) => m[1]);
    assert.deepEqual(order, names.map(slugOf), `${cycle}: one card per module, in order, every one drawn`);
  }
  const v = text(html(h(CycleOverview, { cycle: 'validate', data: OVERVIEWS.validate })));
  assert.match(v, /Interviews this month 14 ▲ 4 in 30 days/);
  assert.match(v, /MRR \$38\.4k ▲ \$2,300 in 30 days/);
  assert.match(v, /Hypotheses supported 3 of 7 no change in 30 days/);
  assert.match(v, /Churn Not recorded nothing recorded yet/);
  assert.match(v, /What Problem discovery shows\. Next: Next step for Problem discovery\./);
});

test('NO OVERVIEW RENDERS A MODULE LIST: the modules are the cards, and nothing lists them again', () => {
  for (const cycle of Object.keys(MODULES)) {
    const out = html(h(CycleOverview, { cycle, data: OVERVIEWS[cycle] }), `/${cycle}`);
    assert.doesNotMatch(out, /<(?:ul|ol|li)[\s>]|role="list"/, `${cycle} draws no list`);
    assert.doesNotMatch(text(out), /\bPro\b|Upgrade/, `${cycle} draws no Pro strip`);
    for (const name of MODULES[cycle]) {
      const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      // Once in the tabs (and once in the phone menu), once as a card's title.
      const cardTitles = (out.match(new RegExp(`>${esc} ›<`, 'g')) || []).length;
      assert.equal(cardTitles, 1, `${name}: one card`);
    }
  }
  for (const f of ['CycleOverview.jsx', 'CycleModulePage.jsx']) assert.doesNotMatch(read(`frontend/src/pages/cycles/${f}`), /<StatusPill|<ProStrip|<ModuleList/, f);
});

test('an unreadable card names its source and offers its own retry, and leaves the others drawn', () => {
  const data = structuredClone(OVERVIEWS.build);
  data.cards[5] = { ...data.cards[5], state: 'unreadable', series: null, reason: 'Stripe could not be read. Last good sync 9 Oct.' };
  const out = html(h(CycleOverview, { cycle: 'build', data, onRetryCard() {} }), '/build');
  assert.match(out, /data-testid="cycle-card-operating-systems" data-state="unreadable"[\s\S]*?Stripe could not be read\. Last good sync 9 Oct\.[\s\S]*?Try again/);
  assert.equal((out.match(/data-state="ok"/g) || []).length, 5, 'the other five are drawn');
  assert.equal((out.match(/Try again/g) || []).length, 1, 'only that card offers a retry');
  assert.doesNotMatch(out, /data-testid="cycle-overview-unreadable"/, 'one card failing is not the page failing');
});

test('the five card states (variant=states and variant=new), each with its sentence and no chart', () => {
  const st = (state, extra = {}) => card('validate', 'Customer research', 1, { state, series: null, ...extra });
  const one = (c) => html(h(CycleCard, { cycle: 'validate', card: c, onRetry() {} }));
  assert.match(html(h(CycleCard, { cycle: 'validate', card: null, slug: '' })), /data-state="loading"[\s\S]*data-testid="card-loading"/);
  const empty = one(st('empty', { reason: 'No interviews yet. Pain themes appear as interviews are logged.', next: { text: 'Record your first session', href: '/validate/record' } }));
  assert.match(text(empty), /No interviews yet\. Pain themes appear as interviews are logged\. Record your first session/);
  assert.match(empty, /href="\/validate\/record"/);
  assert.match(text(one(st('too_little', { reason: '2 interviews so far. The chart appears at 3.' }))), /2 interviews so far\. The chart appears at 3\./);
  assert.match(text(one(st('not_recorded', { reason: 'Churn: not recorded until a customer has been billed twice.' }))), /Not recorded Churn: not recorded until a customer has been billed twice\./);
  assert.match(text(one(st('unreadable', { reason: 'Stripe could not be read.' }))), /Stripe could not be read\. Try again/);
  for (const s of ['empty', 'too_little', 'not_recorded', 'unreadable']) {
    const out = one(st(s, { series: [{ kind: 'big', value: '9' }] }));
    assert.doesNotMatch(out, /data-chart=/, `${s} draws no chart even when a series came back`);
    assert.doesNotMatch(out, /What Customer research shows/, `${s} prints no caption for a chart it does not draw`);
  }
  // variant=new: the first month's figures say what is not recorded yet.
  const fresh = text(html(h(FigureTile, { fig: figure('p', 'Pain themes', null, 'count', { delta_30d: null }) })));
  assert.match(fresh, /Pain themes Not recorded nothing recorded yet/);
  assert.doesNotMatch(html(h(FigureTile, { fig: figure('p', 'Pain themes', 2, 'count', { spark: [1, 2] }) })), /<svg/, 'a two-point sparkline is not drawn');
  assert.match(text(html(h(FigureTile, { fig: figure('m', 'MRR', 5, 'usd', { state: 'unreadable', source: 'Stripe' }) }))), /MRR Stripe could not be read/);
});

test('the overview while loading and when the whole read fails', () => {
  const loading = html(h(CycleOverview, { cycle: 'grow', data: null }), '/grow');
  assert.equal((loading.match(/data-testid="card-loading"/g) || []).length, 6);
  const failed = text(html(h(CycleOverview, { cycle: 'grow', data: null, status: 'unreadable', onRetry() {} }), '/grow'));
  assert.match(failed, /The Grow overview could not be read\. This is not a claim that nothing is recorded\. Retry/);
});

test('EVERY MODULE RENDERS FROM THE SHARED READ: all 26 module pages, with their chart, caption, next action and records', () => {
  let n = 0;
  for (const [cycle, names] of Object.entries(MODULES)) {
    for (const name of names) {
      const c = OVERVIEWS[cycle].cards.find((x) => x.name === name);
      const out = html(h(CycleModulePage, { cycle, slug: c.slug, cards: OVERVIEWS[cycle].cards, data: { module: { slug: c.slug, name }, card: c, records: records(name) }, query: {}, onQuery() {} }), `/${cycle}/${c.slug}`);
      const t = text(out);
      assert.match(out, new RegExp(`data-module="${c.slug}"`));
      assert.match(out, /data-testid="cycle-module-chart" data-state="ok"/, name);
      assert.deepEqual(kinds(out), c.series.map((s) => s.kind), `${name} draws its series in order`);
      assert.ok(t.includes(`What ${name} shows.`) && t.includes(`Next: Next step for ${name}.`), name);
      assert.ok(t.includes(`${name} one`) && t.includes(`${name} two`), `${name} lists its records`);
      assert.match(out, new RegExp(`aria-current="page"[^>]*>${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}<`), `${name} is the current tab`);
      n += 1;
    }
  }
  assert.equal(n, 26);
});

test('the records table: search, filters, sort, pages, Add, a tone pill, a link, and Not recorded for a missing cell', () => {
  const out = html(h(RecordsTable, { title: 'Interviews', records: records('Interviews'), query: { q: 'acme', filter: { status: 'open' }, sort: 'name', page: 1 }, onQuery() {} }));
  const t = text(out);
  assert.match(out, /role="search"/);
  assert.match(out, /value="acme"/, 'the search box starts from the query');
  assert.match(out, /<select aria-label="Status"[^>]*>.*<option value="open" selected="">Open<\/option>/);
  assert.match(out, /<select aria-label="Sort"[^>]*>.*<option value="name" selected="">Sort: Name<\/option>/);
  assert.match(t, /Name State Date Interviews one State Supported Date 12 Oct Interviews two State Not recorded Date Open/);
  assert.match(out, /href="\/validate\/experiments"/);
  assert.match(t, /1–2 of 52/);
  assert.match(out, /aria-label="Pages"[\s\S]*aria-current="page"[^>]*>1<[\s\S]*>2<[\s\S]*>3</);
  assert.match(out, /href="\/validate\/new"[^>]*>Add to Interviews</);
  assert.match(text(html(h(RecordsTable, { title: 'Interviews', records: records('x', { rows: [], total: 0 }), query: { q: 'zzz' } }))), /Nothing matches this search\. 0 of 0/);
  assert.match(text(html(h(RecordsTable, { title: 'Interviews', records: records('x', { rows: [], total: 0 }), query: {} }))), /No records yet\./);
  assert.match(text(html(h(RecordsTable, { title: 'Interviews', status: 'unreadable', onRetry() {} }))), /The interviews could not be read\. This is not a claim that there are none\. Retry/);
  const evil = html(h(RecordsTable, { title: 'X', records: records('x', { rows: [{ id: 1, cells: { name: { text: 'Off-site', href: 'https://evil.test' } } }], add: { text: 'Add', href: '//evil.test' } }) }));
  assert.doesNotMatch(evil, /evil\.test/, 'a read cannot send the reader off-site');
});

test('a module with a full working tool links to it rather than redrawing it', () => {
  const c = OVERVIEWS.raise.cards.find((x) => x.slug === 'cap-table');
  const out = html(h(CycleModulePage, { cycle: 'raise', slug: 'cap-table', data: { card: c, records: records('Cap table') }, tool: { label: 'Open the cap table', href: '/raise/captable' } }), '/raise/cap-table');
  assert.match(out, /data-testid="cycle-module-tool"[^>]*>Open the cap table/);
  assert.match(out, /href="\/raise\/captable"/);
  assert.doesNotMatch(html(h(CycleModulePage, { cycle: 'raise', slug: 'cap-table', data: { card: c }, tool: { href: 'https://evil.test' } })), /cycle-module-tool/);
});

test('a label from a read is text: no chart builds markup from a string', () => {
  const out = html(h(Chart, { spec: { kind: 'hbar', items: [{ label: '<img src=x onerror=alert(1)>', value: 3 }] } }));
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  for (const f of ['CycleCharts.jsx', 'CycleOverview.jsx', 'CycleModulePage.jsx']) assert.doesNotMatch(read(`frontend/src/pages/cycles/${f}`), /dangerouslySetInnerHTML/, f);
});

test('each chart kind draws what it is given, and says Not recorded where a value is missing', () => {
  const draw = (spec) => html(h(Chart, { spec, label: 'x' }));
  assert.match(text(draw({ kind: 'hbar', items: [{ label: 'A', value: 4 }, { label: 'B', value: null }] })), /A 4 B Not recorded/);
  assert.match(text(draw({ kind: 'funnel', steps: [{ label: 'Lead', value: 48 }, { label: 'Done', value: null }] })), /Lead 48 Done Not recorded/);
  assert.match(text(draw({ kind: 'bands', items: [{ label: 'Obtainable', value: null }] })), /Obtainable · Not recorded/);
  assert.match(text(draw({ kind: 'progress', items: [{ label: 'Legal', pct: null }, { label: 'Team', pct: 100 }] })), /Legal Not recorded Team 100%/);
  assert.match(text(draw({ kind: 'tiles', items: [{ label: 'Payroll', state: 'failing' }] })), /Payroll Failing/);
  assert.match(text(draw({ kind: 'timeline', steps: [{ label: 'Formed', date: '12 Oct', done: true }, { label: 'Bank', done: false }] })), /Formed 12 Oct .*Bank Not recorded/);
  assert.match(text(draw({ kind: 'rows', items: [{ label: 'Mismatches', value: null }] })), /Mismatches Not recorded/);
  assert.match(text(draw({ kind: 'big', value: '57%', label: 'need-to-have' })), /57% need-to-have/);
  assert.match(draw({ kind: 'line', values: [1, 2, 3], target: 5, mark: 1, mark_label: 'ship' }), /stroke-dasharray="5 4"[\s\S]*ship/);
  assert.match(draw({ kind: 'stack', rows: [{ label: 'A', parts: [1, 1] }], tones: ['v1', 'v2'], legend: [{ label: 'Strong', tone: 'v1' }] }), /fill-axal-violet[\s\S]*Strong/);
  assert.equal((draw({ kind: 'dots', values: [true, false, true] }).match(/title="Held"/g) || []).length, 2);
  assert.equal((draw({ kind: 'heat', rows: [{ label: 'M1', cells: [1, null, 0.5] }] }).match(/<rect/g) || []).length, 2, 'a missing cell is not drawn');
});

// ------------------------------------------------------------------ not mounted yet

test('A CYCLE IS MOUNTED ONLY ONCE ITS READ IS WIRED: Validate and Raise are; Build and Grow keep their desks', () => {
  const app = read('frontend/src/App.jsx');
  const cyclesApi = read('frontend/src/lib/api/cycles.js');
  // The one route component, mounted per cycle by a literal name.
  const mounted = [...app.matchAll(/<CycleRoute cycle="([a-z]+)" \/>/g)].map((m) => m[1]);
  const wired = [...cyclesApi.matchAll(/^ {2}([a-z]+): \{$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(mounted)].sort(), ['raise', 'validate'], 'only Validate and Raise are mounted');
  for (const c of new Set(mounted)) assert.ok(wired.includes(c), `${c} is mounted with no read in lib/api/cycles.js`);
  assert.match(app, /<Route path="\/validate\/:slug" element=\{guard\([^)]*\), <CycleRoute cycle="validate" \/>\)\} \/>/, 'Validate has its module pages');
  assert.match(app, /<Route path="\/raise\/:slug" element=\{guard\([^)]*\), <CycleRoute cycle="raise" \/>\)\} \/>/, 'Raise has its module pages');
  assert.match(app, /<Route path="\/build" element=\{founderBuildLanding/, '/build keeps its desk');
  assert.match(app, /<Route path="\/grow" element=\{founderGrowLanding/, '/grow keeps its desk');
  // Raise's tools keep their static routes, which win over /raise/:slug.
  for (const tool of ['/raise/pitch', '/raise/data-room', '/raise/capital/cap-table', '/raise/capital/model', '/raise/capital/pipeline']) {
    assert.ok(app.includes(`<Route path="${tool}"`), `${tool} lost its route`);
  }
  // The four zone pages stay mounted: each module page links to the one that
  // edits it until canvases for Add and a record's edit view exist.
  for (const zone of ['interviews', 'pain-map', 'hypotheses', 'verdict']) {
    assert.match(app, new RegExp(`<Route path="/validate/${zone}" element=\\{guard\\([^)]*\\), <FounderValidateWorkspace />\\)\\} />`), `/validate/${zone} lost its working tool`);
  }
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /request\(`\/cycles\//, 'the cycle client lives in lib/api/cycles.js, not api.js');
  for (const f of ['cycleModel.js', 'CycleOverview.jsx', 'CycleModulePage.jsx', 'CycleCharts.jsx', 'adapters/index.js', 'adapters/validate.js']) {
    assert.doesNotMatch(read(`frontend/src/pages/cycles/${f}`), /from '\.\.\/\.\.\/lib\/api|from '\.\.\/\.\.\/\.\.\/lib\/api|api\./, `${f} reads nothing itself`);
  }
});

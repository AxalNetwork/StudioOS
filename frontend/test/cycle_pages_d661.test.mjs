/**
 * D661 (#1474) — the cycle overview and module page components, against
 * fixtures shaped exactly like #1469's shared read (D656): the card states,
 * the chart specs, the figures, the records table, the links that keep a
 * chosen venture, and which cycles are mounted.
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
  figureDelta, figureValue, lineSegments, moduleQuery, nextHref, pageButtons, recordsCount, safeHref, share, sparkDrawable,
} from '../src/pages/cycles/cycleModel.js';
import CycleOverview, { CycleCard, FigureTile } from '../src/pages/cycles/CycleOverview.jsx';
import CycleModulePage, { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { Chart } from '../src/pages/cycles/CycleCharts.jsx';
import DurabilityChecklist from '../src/pages/cycles/DurabilityChecklist.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { EDITS, FORMS, editFor, formFor } from '../src/pages/cycles/forms.js';
import { MODULES, OVERVIEWS, card, figure, records, slugOf } from './_cycle_fixtures.mjs';
import { MODULES as LIVE_MODULES } from '../src/pages/cycles/modules.js';

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
    [['Overview', '/build', false], ['Tools', '/build/operating-systems#tools', false], ['Founding team', '/build/founding-team', true]], 'Build\'s Tools history is its second tab (#1597)');
});

test('A CHOSEN VENTURE RIDES ON EVERY LINK: tabs, card titles and the module page keep `?project_id=`', () => {
  assert.deepEqual(cycleTabs('grow', [{ slug: 'distribution', name: 'Distribution' }], null, '?project_id=7').map((t) => t.href),
    ['/grow?project_id=7', '/grow/durable-company-building?project_id=7#updates', '/grow/distribution?project_id=7']);
  for (const bad of ['project_id=7', '//evil.test', '?', null, 7]) {
    assert.deepEqual(cycleTabs('grow', [{ slug: 'distribution' }], null, bad).map((t) => t.href), ['/grow', '/grow/durable-company-building#updates', '/grow/distribution'], String(bad));
  }
  const over = html(h(CycleOverview, { cycle: 'validate', data: OVERVIEWS.validate, search: '?project_id=7' }));
  // The tabs, and each card's title link (its name and ›). A card's own
  // `next.href` is the read's link and is left as it came.
  const navOf = (out) => [...out.matchAll(/data-testid="cycle-tabs"[\s\S]*?<\/nav>/g)][0][0];
  const own = [
    ...[...navOf(over).matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    ...[...over.matchAll(/href="([^"]+)"[^>]*>[^<]* ›</g)].map((m) => m[1]),
  ];
  // Overview, then each module and each card's title (D694).
  assert.equal(own.length, 1 + MODULES.validate.length * 2, 'the tabs and every card title');
  for (const l of own) assert.match(l, /\?project_id=7$/, l);
  const mod = html(h(CycleModulePage, { cycle: 'validate', slug: slugOf(MODULES.validate[0]), cards: OVERVIEWS.validate.cards, data: { card: OVERVIEWS.validate.cards[0] }, search: '?project_id=7' }));
  for (const m of navOf(mod).matchAll(/href="([^"]+)"/g)) assert.match(m[1], /\?project_id=7$/, m[1]);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /searchParams\.get\('project_id'\) \|\| searchParams\.get\('project'\)/, "the read's own `?project=` links pick the venture too");
  assert.equal((route.match(/search=\{q\}/g) || []).length, 4, 'the overview, module, record header and Validate\'s phone focus keep the venture');
});

test('GROW: money in a chart reads in dollars, the checklist says what ticked it, and Share an update opens the sheet', () => {
  // `unit: 'usd'` on a spec: CAC, MRR movements and partner revenue.
  const hbar = html(h(Chart, { spec: { kind: 'hbar', unit: 'usd', items: [{ label: 'LinkedIn', value: 600 }, { label: 'Ads', value: null }] }, label: 'CAC' }));
  assert.match(hbar, />\$600</);
  assert.match(hbar, />Not recorded</, 'a missing CAC is not $0');
  assert.match(html(h(Chart, { spec: { kind: 'vbars', unit: 'usd', values: [800, 1200] }, label: 'Revenue' })), />\$1,200</);
  assert.match(html(h(Chart, { spec: { kind: 'rows', unit: 'usd', items: [{ label: 'Partner-sourced revenue', value: 0 }] } })), />\$0</, 'a recorded zero is $0');
  assert.match(html(h(Chart, { spec: { kind: 'hbar', items: [{ label: 'Talking', value: 6 }] }, label: 'Partners' })), />6</, 'a count has no $');
  const list = html(h(DurabilityChecklist, { items: [
    { key: 'ein_received', label: 'Tax ID (EIN) received', done: true, source: 'Spin-Out Lab', done_at: '2026-09-01T00:00:00Z' },
    { key: 'key_person_cover', label: 'Key-person cover set up', done: true, source: 'manual', done_at: null },
    { key: 'board_cadence', label: 'Board meeting cadence agreed', done: false, source: null, done_at: null },
  ] }));
  assert.match(text(list), /Durability checklist 2 of 3 done/);
  assert.match(text(list), /Tax ID \(EIN\) received Done · Spin-Out Lab · 2026-09-01/);
  assert.match(text(list), /Key-person cover set up Done · typed/);
  assert.match(text(list), /Board meeting cadence agreed Not done/);
  assert.equal(html(h(DurabilityChecklist, { items: null })), '', 'nothing to list draws nothing');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // D686 §5.1: Share an update opens at /grow/update over the page; a sent
  // update replaces that address with its own page, so Back never reopens it.
  assert.match(route, /path: 'update',\s*Mount: GrowMount,\s*action: \(q, open\) => \(\{ label: 'Share an update', href: `\/grow\/update\$\{q\}`, onOpen: open \}\)/);
  assert.match(route, /return <ShareUpdateLightbox projectId=\{projectId\} onClose=\{onClose\} onSent=\{onDone\} \/>;/);
  // D686 §5.4: the mount also re-reads the cycle page after a change (Build's
  // Connect a tool), once the lightbox closes, so nothing reloads behind it.
  assert.match(route, /<Mount projectId=\{projectId\} q=\{q\} searchParams=\{searchParams\} onClose=\{closeAction\} onDone=\{onDone\}\s*onChanged=\{\(\) => \{ dirty\.current = true; \}\} \/>/);
  // However it closes (×, Escape, a finish or the browser's Back): the re-read
  // follows the route leaving the lightbox, not the × (cycle_lightbox_d686).
  assert.match(route, /useEffect\(\(\) => \{\s*if \(!lightbox && dirty\.current\) \{ dirty\.current = false; setReload\(\(n\) => n \+ 1\); \}\s*\}, \[lightbox\]\);/);
  assert.match(route, /cycle === 'grow' \? \(uid\) => navigate\(`\/updates\/\$\{encodeURIComponent\(uid\)\}`, \{ replace: true \}\)/,
    'a sent update opens its page, as it did from the Grow desk');
});

test('BUILD: the one way to create a startup survives, next links keep the venture, and single-part stacks share a scale', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // `/build?new=1` is the only address for creating a startup (sixteen links,
  // the Command Palette's among them). The Build cycle page carries the form.
  assert.match(route, /creates: true,/);
  assert.match(route, /useState\(\(\) => creates && searchParams\.get\('new'\) === '1'\)/, 'seeded from ?new=1 on mount');
  assert.match(route, /useEffect\(\(\) => \{\s*if \(creates && searchParams\.get\('new'\) === '1'\) setCreating\(true\);\s*\}, \[creates, searchParams\]\)/,
    'and followed when ?new=1 arrives on an already-mounted page');
  assert.match(route, /<CreateStartupForm\s+open=\{creating\}/);
  assert.match(route, /onCreated=\{\(created\) => \{ if \(created\?\.id\) writeProject\(created\.id, \['new'\]\); setProjectsKey\(\(n\) => n \+ 1\); \}\}/, 'a new startup is selected and read back');
  assert.match(route, /to="\/build\?new=1" data-testid="cycle-create-venture"/, 'every other cycle with no venture points at the form');
  assert.match(route, /path: 'connect',\s*Mount: BuildMount,\s*action: \(q, open\) => \(\{ label: 'Connect a tool', href: `\/build\/connect\$\{q\}`, onOpen: open \}\)/);
  for (const surface of ['build/roadmap', 'build/this-week', 'build/retro', 'build/kpi']) assert.ok(route.includes(`surface: '${surface}'`), `the Build desk's ${surface} band was dropped`);
  // A read's next link with no query of its own keeps the chosen venture.
  assert.equal(nextHref('/build/prototype-mvp', '?project_id=7'), '/build/prototype-mvp?project_id=7');
  assert.equal(nextHref('/validate/problem-discovery?project=7', '?project_id=9'), '/validate/problem-discovery?project=7', 'a link that names its venture is left alone');
  assert.equal(nextHref('https://evil.test/x', '?project_id=7'), null);
  assert.equal(nextHref('/build/x', 'nope'), '/build/x');
  const empty = { slug: 'company-creation', name: 'Company creation', state: 'empty', series: [], reason: 'No filings yet.', next: { text: 'Add a filing', href: '/build/company-creation' } };
  assert.match(html(h(CycleCard, { cycle: 'build', card: empty, search: '?project_id=7' }), '/build'), /href="\/build\/company-creation\?project_id=7"/);
  // Now / Next / Later: one part per row, so the rows share one scale.
  const roadmap = html(h(Chart, { spec: { kind: 'stack', rows: [{ label: 'Now', parts: [6] }, { label: 'Next', parts: [3] }, { label: 'Later', parts: [0] }], tones: ['v1'] } }));
  const widths = [...roadmap.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths, [359, 179], 'Now is the longest bar and Next half of it; Later draws none');
  assert.match(text(roadmap), /Later 0/, 'a recorded zero row says 0, not Not recorded');
  const shares = html(h(Chart, { spec: { kind: 'stack', rows: [{ label: 'Spain', parts: [8, 2] }, { label: 'France', parts: [1, 1] }], tones: ['v1', 'v2'] } }));
  const shareWidths = [...shares.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(shareWidths, [287, 71, 179, 179], 'rows with several parts still split their own total');
});

test('ADD FORMS: one dialog draws each form, the module offers it, and the checklist can be ticked', () => {
  // D695: the centred dialog replaces the side sheet; it draws no required marker (decision 14).
  const sheet = html(h(FormLightbox, { form: formFor('grow', 'market-expansion'), cycle: 'grow', slug: 'market-expansion', onSubmit: async () => {}, onClose() {} }));
  assert.match(sheet, /role="dialog" aria-modal="true" aria-label="Add market"/);
  assert.match(text(sheet), /Grow · Market expansion Add market/);
  assert.doesNotMatch(text(sheet), /· required/);
  // D695 (#1657): a checked Score with sources row reveals its score, typed as a number.
  assert.match(sheet, /data-testid="cycle-form-demand_score"[^>]*type="number"/);
  assert.doesNotMatch(sheet, /cycle-form-regulation_score/, 'an unchecked row shows no score');
  assert.equal(html(h(FormLightbox, { form: null, cycle: 'grow' })), '', 'no form, no dialog');
  const channel = html(h(FormLightbox, { form: formFor('grow', 'distribution'), cycle: 'grow', slug: 'distribution', onSubmit: async () => {}, onClose() {} }));
  assert.doesNotMatch(channel, /utm_source/, 'the UTM source is derived from the name (#1697), never typed');
  assert.match(channel, /inputMode="decimal"/, 'money is typed as an amount');
  // Every module with a form, and no other, offers Add from it.
  assert.deepEqual(Object.entries(FORMS).flatMap(([c, f]) => Object.keys(f).map((s) => `${c}/${s}`)).sort(),
    ['build/company-creation', 'build/founding-team', 'build/operating-systems', 'build/product-roadmap', 'build/prototype-mvp', 'build/solution-design', 'grow/distribution', 'grow/durable-company-building', 'grow/market-expansion', 'grow/partner-network', 'grow/product-improvement', 'grow/revenue-and-traction', 'grow/team-expansion', 'raise/cap-table', 'raise/capital-relationships', 'raise/data-room', 'raise/fundraising-readiness', 'raise/investor-narrative', 'raise/pitch-deck', 'raise/use-of-funds', 'validate/demand-signals', 'validate/experiments', 'validate/ideal-customer-profile', 'validate/market-intelligence', 'validate/problem-discovery']);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // D695: each Add is a link to its `/new` address, pushed with `state.under`.
  assert.match(route, /add=\{forms\.length && projectId\s*\? forms\.map\(\(entry, i\) => \(\{ text: entry\.button, href: addHref\(entry, i\), state: \{ under: `\$\{location\.pathname\}\$\{location\.search\}` \} \}\)\)\s*: fnOf\(def\.add, slug\)\?\.\(q, openAction\)\}/);
  assert.match(route, /onSubmit=\{\(values\) => formOpen\.submit\(cyclesWrite, projectId, values\)\}/);
  assert.match(route, /const saved = \(\) => \{ dirty\.current = true; \};/);
  // D695 (#1656): the Add, an Edit from the row's values, and an Edit from its record (Validate's).
  assert.equal((route.match(/onSaved=\{saved\}/g) || []).length, 3, 'a save, Add or Edit, reads the module again once the form closes');
  // The checklist: tick an open item, undo your own tick, never undo the Lab's.
  const items = [
    { key: 'ein_received', label: 'Tax ID (EIN) received', done: true, source: 'Spin-Out Lab', done_at: null },
    { key: 'key_person_cover', label: 'Key-person cover set up', done: true, source: 'manual', done_at: null },
    { key: 'board_cadence', label: 'Board meeting cadence agreed', done: false, source: null, done_at: null },
  ];
  const ticks = html(h(DurabilityChecklist, { items, onToggle: async () => {} }));
  assert.match(ticks, /data-testid="checklist-tick-board_cadence"/);
  assert.match(ticks, /data-testid="checklist-untick-key_person_cover"/);
  assert.doesNotMatch(ticks, /checklist-(un)?tick-ein_received/, 'a Lab milestone is not undone by hand');
  assert.doesNotMatch(html(h(DurabilityChecklist, { items })), /checklist-tick/, 'read-only without onToggle');
});

test('ROW EDITS: a row the route can change draws Edit, the sheet starts from the row, and the save reads the module again', () => {
  const recs = { cols: [{ key: 'channel', label: 'Channel' }, { key: 'state', label: 'State' }], rows: [
    { id: 'c1', cells: { channel: 'Podcasts', state: 'Active' } },
    { id: 'c2', cells: { channel: null, state: 'Paused' } },
    { id: 'c3', cells: { channel: 'Read only', state: 'Active' } },
  ], total: 3, page: 1, page_size: 25 };
  const rowAction = (row) => (row.id === 'c3' ? null : { text: 'Edit', label: `Edit ${row.cells.channel || 'this row'}`, onClick() {} });
  const table = html(h(RecordsTable, { title: 'Channels', records: recs, rowAction }));
  assert.equal((table.match(/data-testid="records-row-action"/g) || []).length, 2, 'one Edit per row it can change, none on the third');
  assert.match(table, /aria-label="Edit Podcasts"/);
  assert.match(table, /aria-label="Edit this row"/, 'a row with no name still says what it edits');
  assert.match(table, /role="columnheader" class="sr-only">Actions</);
  assert.equal((table.match(/role="cell"/g) || []).length, 9, 'every row keeps one cell per column, the action cell included');
  assert.doesNotMatch(html(h(RecordsTable, { title: 'Channels', records: recs })), /records-row-action|Actions</, 'no rowAction, no column');
  // The dialog starts from the row's own values, as text; a choice is a checked chip (D695).
  const market = editFor('grow', 'market-expansion');
  const sheet = html(h(FormLightbox, { form: market, current: { state: 'entering', decision: 'enter', parts: ['demand'], demand_score: 7, demand_source: 'Waitlist' }, cycle: 'grow', slug: 'market-expansion', onSubmit: async () => {}, onClose() {} }));
  assert.match(sheet, /aria-label="Edit market"/);
  assert.match(sheet, /data-testid="cycle-form-demand_score"[^>]*value="7"/);
  assert.match(sheet, /data-testid="cycle-form-demand_source"[^>]*value="Waitlist"/);
  assert.match(sheet, /<input[^>]*type="radio"[^>]*name="state" checked="" value="entering"\/>/);
  // Every module with an Edit form, and the page wiring. D686 §5.4 adds Operating systems' connector mapping.
  assert.deepEqual(Object.entries(EDITS).flatMap(([c, f]) => Object.keys(f).map((s) => `${c}/${s}`)).sort(),
    ['build/company-creation', 'build/founding-team', 'build/operating-systems', 'build/product-roadmap', 'build/prototype-mvp', 'build/solution-design', 'grow/distribution', 'grow/durable-company-building', 'grow/market-expansion', 'grow/partner-network', 'grow/product-improvement', 'grow/revenue-and-traction', 'grow/team-expansion', 'raise/cap-table', 'raise/capital-relationships', 'raise/data-room', 'raise/investor-narrative', 'raise/pitch-deck', 'raise/use-of-funds', 'validate/demand-signals', 'validate/experiments', 'validate/ideal-customer-profile', 'validate/market-intelligence', 'validate/problem-discovery']);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /rowAction=\{edit && projectId && !edit\.hiddenFor\?\.\(module\) \? \(row\) => \(edit\.idOf\(row\) == null \? null : \{/, 'Edit is drawn only on a row its route can change, and not on a card the module hides it for');
  assert.match(route, /<FormLightbox key=\{`edit-\$\{editing\.id\}`\} form=\{edit\} current=\{edit\.valuesOf\(editing\)\}/);
  assert.match(route, /onSubmit=\{\(values\) => edit\.submit\(cyclesWrite, projectId, edit\.idOf\(editing\), values\)\}/);
  // D695: the open Add is the address's and the open Edit the history entry's, so neither follows the founder to another module.
  assert.match(route, /const formOpen = adding && forms\.length \? forms\.find\(\(f\) => f\.key === searchParams\.get\('form'\)\) \|\| forms\[0\] : null;/);
  assert.match(route, /const editingId = !adding && edit && location\.state\?\.editing != null \? String\(location\.state\.editing\) : null;/);
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
      assert.ok(t.includes(`What ${name} shows.`) && t.includes(`${name} · at a glance`) && !t.includes(`Next: Next step for ${name}.`), name);
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

test('A CYCLE IS MOUNTED ONLY ONCE ITS READ IS WIRED: all four are, each with its module pages', () => {
  const app = read('frontend/src/App.jsx');
  const cyclesApi = read('frontend/src/lib/api/cycles.js');
  // The one route component, mounted per cycle by a literal name.
  const mounted = [...app.matchAll(/<CycleRoute cycle="([a-z]+)" \/>/g)].map((m) => m[1]);
  const wired = [...cyclesApi.matchAll(/^ {2}([a-z]+): \{$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(mounted)].sort(), ['build', 'grow', 'raise', 'validate'], 'all four cycles are mounted');
  for (const c of new Set(mounted)) assert.ok(wired.includes(c), `${c} is mounted with no read in lib/api/cycles.js`);
  assert.match(app, /<Route path="\/validate\/:slug" element=\{guard\([^)]*\), <CycleRoute cycle="validate" \/>\)\} \/>/, 'Validate has its module pages');
  assert.match(app, /<Route path="\/raise\/:slug" element=\{guard\([^)]*\), <CycleRoute cycle="raise" \/>\)\} \/>/, 'Raise has its module pages');
  assert.match(app, /<Route path="\/build" element=\{founderBuildLanding\s*\? guard\(\[[^\]]*\], <CycleRoute cycle="build" \/>\)/, "a founder's /build is the Build overview");
  assert.match(app, /<Route path="\/build\/:slug" element=\{guard\(\[[^\]]*\], <CycleRoute cycle="build" \/>\)\} \/>/, 'Build has its module pages');
  // Every Build page keeps its static route, and no module slug is one of them.
  const buildPages = [...app.matchAll(/<Route path="\/build\/([a-z-]+)"/g)].map((m) => m[1]);
  for (const page of ['roadmap', 'cadence', 'kpi', 'this-week', 'board', 'team', 'competitors', 'captable']) assert.ok(buildPages.includes(page), `/build/${page} lost its route`);
  for (const m of LIVE_MODULES.build) assert.ok(!buildPages.includes(m.slug), `${m.slug} would be shadowed by a Build page`);
  assert.match(app, /<Route path="\/grow" element=\{founderGrowLanding\s*\? guard\(\[[^\]]*\], <CycleRoute cycle="grow" \/>\)/, "a founder's /grow is the Grow overview");
  assert.match(app, /<Route path="\/grow\/:slug" element=\{guard\(\[[^\]]*\], <CycleRoute cycle="grow" \/>\)\} \/>/, 'Grow has its module pages');
  // The seven Grow pages keep their static routes, and no module slug is one of them.
  const growPages = ['focus', 'talent', 'customers', 'partnerships', 'capital-match', 'brand', 'launch'];
  for (const page of growPages) assert.ok(app.includes(`<Route path="/grow/${page}"`), `/grow/${page} lost its route`);
  for (const m of LIVE_MODULES.grow) assert.ok(!growPages.includes(m.slug), `${m.slug} would be shadowed by a Grow page`);
  // Raise's tools keep their static routes, which win over /raise/:slug.
  for (const tool of ['/raise/pitch', '/raise/data-room', '/raise/capital/cap-table', '/raise/capital/model', '/raise/capital/pipeline']) {
    assert.ok(app.includes(`<Route path="${tool}"`), `${tool} lost its route`);
  }
  // The four zone pages stay mounted: each module page links to the one that
  // edits it until canvases for Add and a record's edit view exist.
  for (const zone of ['pain-map', 'hypotheses', 'verdict']) {
    assert.match(app, new RegExp(`<Route path="/validate/${zone}" element=\\{guard\\([^)]*\\), <FounderValidateWorkspace />\\)\\} />`), `/validate/${zone} lost its working tool`);
  }
  // D686: the interview log is a founder tool, with its one return to Customer research.
  assert.match(app, /<Route path="\/validate\/interviews" element=\{guard\([^)]*\), founderEditor\(<FounderValidateWorkspace \/>\)\)\} \/>/, '/validate/interviews lost its working tool');
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /request\(`\/cycles\//, 'the cycle client lives in lib/api/cycles.js, not api.js');
  for (const f of ['cycleModel.js', 'CycleOverview.jsx', 'CycleModulePage.jsx', 'CycleCharts.jsx', 'DurabilityChecklist.jsx', 'adapters/index.js', 'adapters/validate.js', 'adapters/grow.js']) {
    assert.doesNotMatch(read(`frontend/src/pages/cycles/${f}`), /from '\.\.\/\.\.\/lib\/api|from '\.\.\/\.\.\/\.\.\/lib\/api|api\./, `${f} reads nothing itself`);
  }
});

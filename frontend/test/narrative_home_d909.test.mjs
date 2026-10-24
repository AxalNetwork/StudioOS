/**
 * D909 (#2693) — the Investor narrative's Home tiles and Needs you (NAR1), the
 * New version line (NAR11) and Versions' based-on lines, Read by and actions
 * (NAR12): the derivations (`narrativeModel.js`), Home rendered from the
 * Worker's `parts.narrative`, the Versions tab mounted, and the wiring.
 *
 * Every name and figure is a fixture.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_home_d909.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { NarrativeHome } from '../src/pages/raise/narrative/NarrativeTool.jsx';
import { FORMS, startFromChips } from '../src/pages/cycles/forms.js';
import {
  CLAIMS_WAIT, NEEDS_NONE, NOT_RECORDED, OBJECTIONS_WAIT, compareView, deleteLine, duplicateSentence, homeFooter, homePart, homeTiles,
  needsYou, newVersionLine, nextVersion, readByLine, startFromHref, versionSub,
} from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// GET /api/cycles/raise/modules/investor-narrative → parts.narrative (raiseCycle.ts narrativeHome)
const PART = {
  state: 'ok',
  versions: [
    { version: 4, audience: 'Seed fund', based_on: 'v1', saved: '2026-10-20', by: 'Fay Founder', read_by: { deck_version: 6, cards: [1, 2, 5] } },
    { version: 3, audience: 'Angel', based_on: 'v2', saved: '2026-10-06', by: null, read_by: null },
    { version: 1, audience: 'Seed fund', based_on: null, saved: '2026-09-02', by: 'Fay Founder', read_by: null },
  ],
  newest: { version: 4, compared: 2, mismatches: [{ figure: 'MRR', sentence: 'MRR: $18,400 in Narrative · traction.takeaway, $16,950 in Metrics · project_metrics.mrr on 2026-09-30' }] },
  deck: { version: 6, reads_narrative: true },
  spinout: false,
};
const data = (part) => ({ parts: { narrative: part } });

test('NAR1 tiles: Versions and Open mismatches from the read; Claims backed and Objections answered a dash with the reason, never 0', () => {
  const tiles = homeTiles(PART);
  assert.deepEqual(tiles.map((t) => [t.label, t.value, t.sub]), [
    ['Versions', '3', 'Newest v4 · Seed fund'],
    ['Claims backed', '—', CLAIMS_WAIT],
    ['Open mismatches', '1', 'MRR, in v4'],
    ['Objections answered', '—', OBJECTIONS_WAIT],
  ]);
  assert.deepEqual(homeTiles({ ...PART, newest: { version: 4, compared: 0, mismatches: [] } }).find((t) => t.key === 'mismatches'),
    { key: 'mismatches', label: 'Open mismatches', value: '—', sub: 'Nothing compared yet in v4', waits: true }, 'nothing compared is not "no mismatch"');
  assert.equal(homeTiles({ ...PART, newest: { version: 4, compared: 3, mismatches: [] } }).find((t) => t.key === 'mismatches').value, '0', 'a real zero once compared');
  assert.deepEqual(homeTiles({ state: 'ok', versions: [], newest: null }).map((t) => [t.value, t.sub]).slice(0, 3),
    [['0', 'No version yet'], ['—', CLAIMS_WAIT], ['—', 'No version yet']]);
  assert.equal(homePart(data({ state: 'unreadable' })), null);
});

test('Needs you lists each mismatch of the newest version, opened on its Check; the footer says whether a deck reads the narrative', () => {
  assert.deepEqual(needsYou(PART, '?project_id=3'), [{
    key: 'MRR-0', pill: 'Mismatch', title: 'MRR', sub: PART.newest.mismatches[0].sentence,
    href: '/raise/investor-narrative/check?project_id=3&version=4',
  }]);
  assert.deepEqual(needsYou({ ...PART, newest: null }), []);
  assert.equal(homeFooter(PART), 'The Pitch deck studio reads your narrative.');
  assert.equal(homeFooter({ ...PART, deck: { version: 6, reads_narrative: false } }), 'No card of your pitch deck reads your narrative yet.');
  assert.equal(homeFooter({ ...PART, deck: null }), 'No pitch deck yet, so nothing reads your narrative.');
});

test('Home renders the tiles, Needs you and the footer from the part, or says the read failed', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(NarrativeHome, { data: data(PART), search: '?project_id=3' })));
  for (const id of ['narrative-tile-versions', 'narrative-tile-claims', 'narrative-tile-mismatches', 'narrative-tile-objections', 'narrative-needs-you', 'narrative-needs-row', 'narrative-home-footer']) {
    assert.ok(html.includes(`data-testid="${id}"`), id);
  }
  assert.ok(html.includes(CLAIMS_WAIT) && html.includes(OBJECTIONS_WAIT));
  assert.ok(html.includes('href="/raise/investor-narrative/check?project_id=3&amp;version=4"'));
  assert.ok(!/\[[^\]]*\]/.test(html.replace(/<[^>]+>/g, '')), 'no canvas sample');
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(NarrativeHome, { data: data({ ...PART, newest: { version: 4, compared: 1, mismatches: [] } }) })));
  assert.ok(none.includes(NEEDS_NONE));
  const bad = renderToStaticMarkup(h(MemoryRouter, null, h(NarrativeHome, { data: data({ state: 'unreadable', reason: 'x' }) })));
  assert.ok(bad.includes('data-testid="narrative-home-unreadable"'));
  assert.equal(renderToStaticMarkup(h(MemoryRouter, null, h(NarrativeHome, { data: {} }))), '', 'no part, nothing drawn');
});

test('NAR11: the dialog says what it creates and which version stays; the Spin-Out wording only for a Spin-Out venture', () => {
  const saved = [{ value: '2', label: 'v2 · angel' }, { value: '4', label: 'v4 · seed fund' }];
  assert.equal(nextVersion(saved), 5);
  assert.equal(nextVersion([]), 1);
  assert.equal(newVersionLine({ investor_type: 'series_a_fund', start_from: 'version-2' }, saved), 'Creates v5 for Series A funds. Nothing in v2 changes.');
  assert.equal(newVersionLine({ investor_type: 'angel', start_from: 'blank' }, saved), 'Creates v5 for angels. Nothing in v4 changes.');
  assert.equal(newVersionLine({ investor_type: 'seed_fund', start_from: 'blank' }, []), 'Creates v1 for seed funds.');
  assert.deepEqual(startFromChips(saved).map((o) => o.value), ['version-4', 'version-2', 'blank']);
  assert.deepEqual(startFromChips(saved, true).map((o) => [o.value, o.label]),
    [['version-4', 'v4 · seed fund'], ['version-2', 'v2 · angel'], ['live', 'The Spin-Out deck wording'], ['blank', 'Blank']]);
  const form = FORMS.raise['investor-narrative'][0];
  assert.equal(form.fields[0].k, 'Audience');
  assert.deepEqual(form.fromQuery(new URLSearchParams('start_from=version-3')), { start_from: 'version-3' });
  assert.deepEqual(form.fromQuery(new URLSearchParams('start_from=live')), {}, 'only a saved version comes from the address');
  assert.equal(form.toBody({ investor_type: 'angel' }).start_from, 'blank', 'nothing chosen is blank, never the live wording');
  assert.equal(startFromHref(3, '?project_id=9&version=4'), '/raise/investor-narrative/new?project_id=9&start_from=version-3');
});

test('NAR12: based-on lines, Read by, why a version cannot be deleted, and the compare as D908 states it', () => {
  assert.equal(versionSub(PART.versions[0]), 'from v1 · saved 2026-10-20 · by Fay Founder');
  assert.equal(versionSub(PART.versions[1]), `from v2 · saved 2026-10-06 · by ${NOT_RECORDED}`);
  assert.equal(versionSub(PART.versions[2]), `from ${NOT_RECORDED} · saved 2026-09-02 · by Fay Founder`);
  assert.equal(readByLine(PART.versions[0]), 'Pitch deck v6 · cards 1, 2, 5');
  assert.equal(readByLine({ read_by: { deck_version: 6, cards: [3] } }), 'Pitch deck v6 · card 3');
  assert.equal(readByLine(PART.versions[1]), 'No deck reads this version.');
  assert.equal(deleteLine(PART.versions[0]), 'v4 cannot be deleted while Pitch deck v6 reads it.');
  assert.equal(deleteLine(PART.versions[1]), null);
  assert.equal(duplicateSentence(PART.versions[1], 5), 'Creates v5, a copy of v3 for Angel. Nothing in v3 changes.');
  assert.deepEqual(compareView({ pairs: [
    { key: 'problem', label: 'Problem', a: { body: 'x' }, b: { body: 'x' }, state: 'same' },
    { key: 'traction', label: 'Traction', a: { body: null }, b: { body: 'y' }, state: 'changed' },
    { key: 'team', label: 'Team', a: { body: null }, b: { body: null }, state: 'not_recorded' },
  ] }).map((r) => [r.key, r.a, r.b, r.changed]), [['problem', 'x', 'x', false], ['traction', null, 'y', true], ['team', null, null, false]]);
  assert.deepEqual(compareView(null), []);
});

/* ------------------------------------------------------------------ *
 * The Versions tab, mounted
 * ------------------------------------------------------------------ */

const OPTIONS = { versions: [{ value: '1', label: 'v1 · seed fund' }, { value: '3', label: 'v3 · angel' }, { value: '4', label: 'v4 · seed fund' }] };
const COMPARE = { a: 3, b: 4, pairs: [{ key: 'traction', label: 'Traction', a: { body: null }, b: { body: 'Pilots convert to paid.' }, state: 'changed' }] };
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'x' },
  records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 }, parts: { narrative: PART } };

async function mounted(url, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET']); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, text: () => text(container), byId, props,
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async click(id) { await act(async () => props(byId(id)[0]).onClick?.({ preventDefault() {} })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const handler = (u) => {
  if (u.includes('/form-options')) return response(OPTIONS);
  if (u.includes('/narrative/compare?')) return response(COMPARE);
  if (u.includes('/actions/duplicate')) return response({ ok: true, record: { version: 5 } });
  if (u.includes('/cycles/raise/modules/investor-narrative?')) return response(MODULE);
  return response({});
};

test('Versions: each version with where it started, the compare from D908, Read by, and Duplicate behind its dialog', async () => {
  const view = await mounted('/raise/investor-narrative/versions?project_id=3', handler);
  try {
    assert.ok(view.requests.some(([u]) => u.includes('/cycles/raise/narrative/compare?project=3&a=3&b=4')));
    assert.ok(view.byId('narrative-version-sub').length === 3, 'a based-on line per version the part lists');
    assert.ok(view.text().includes('from v1 · saved 2026-10-20 · by Fay Founder'));
    assert.ok(view.text().includes('Pitch deck v6 · cards 1, 2, 5'));
    assert.ok(view.text().includes('No deck reads this version.'));
    assert.ok(view.text().includes('v4 cannot be deleted while Pitch deck v6 reads it.'));
    assert.ok(!/delete v\d|>Delete</i.test(view.text()), 'no Delete control');
    assert.ok(view.hrefs().includes('/raise/investor-narrative/new?project_id=3&start_from=version-3'), 'Make v3 the start of a new version');
    // Duplicate writes nothing until its dialog is confirmed.
    await view.click('narrative-duplicate');
    assert.equal(view.byId('narrative-duplicate-dialog').length, 1);
    assert.ok(view.text().includes('Creates v5, a copy of v4 for Seed fund. Nothing in v4 changes.'));
    assert.ok(!view.requests.some(([u]) => u.includes('/actions/duplicate')), 'nothing written yet');
    await view.click('narrative-duplicate-confirm');
    const posts = view.requests.filter(([u]) => u.includes('/actions/duplicate'));
    assert.equal(posts.length, 1);
    assert.match(posts[0][0], /\/cycles\/raise\/modules\/investor-narrative\/records\/4\/actions\/duplicate\?project=3/);
    assert.equal(posts[0][1], 'POST');
  } finally { await view.close(); }
});

test('Versions: a failed compare says so, never "the same"', async () => {
  const view = await mounted('/raise/investor-narrative/versions?project_id=3', (u) => (u.includes('/narrative/compare?') ? response({ detail: 'x', code: 'unreadable' }, 503) : handler(u)));
  try {
    assert.ok(view.text().includes('This is not a claim that the two versions are the same.'));
  } finally { await view.close(); }
});

test('the wiring: Home is the module part, never a fork; /new is today\'s address; the client calls D908\'s compare', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /'investor-narrative': \(data, ctx\) => \(\s*<>\s*<NarrativeHome data=\{data\} \/>\s*\{mercuryPart\('investor-narrative', data, ctx\)\}/);
  assert.equal((route.match(/<CycleModulePage|<ModulePage/g) || []).length >= 1, true);
  const api = read('frontend/src/lib/api/cycles.js');
  assert.ok(api.includes('narrativeCompare: (projectId, a, b) => request(`/cycles/raise/narrative/compare?project=${encodeURIComponent(projectId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)'));
  const tool = read('frontend/src/pages/raise/narrative/NarrativeTool.jsx');
  assert.equal(/cyclesApi\.record\(/.test(tool.slice(tool.indexOf('function VersionsTab'), tool.indexOf('export function NarrativeHome'))), false, 'Versions reads no record to compare');
  assert.match(tool, /title=\{`Duplicate v\$\{version\.version\}\?`\}/, 'Duplicate opens a dialog');
});

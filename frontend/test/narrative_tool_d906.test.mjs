/** D906 (#2454): the Investor narrative tool's tabs inside its module page, mounted against stubbed reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  CHECK_RUNS, HOME_PATH, TABS, checkRows, checkSummary, chosenVersion, compareRows, isNarrativeTab, previousVersion,
  storyRows, tabHref, tabSearch, versionHref, versionsOf,
} from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The Worker's shapes (`services/records/raise.ts`): form-options' versions,
// and a version record's "The narrative" and "Consistency check" sections.
const OPTIONS = { versions: [{ value: '2', label: 'v2 · angel' }, { value: '4', label: 'v4 · seed fund' }, { value: '3', label: 'v3 · pre-seed fund' }] };
const version = (n, oneLiner) => ({
  title: `v${n} · seed fund`, sub: 'Saved 20 Oct 2026', pills: [], facts: [],
  main: [
    { key: 'narrative', title: 'The narrative', action: 'edit', rows: [
      { a: 'One-liner', b: oneLiner }, { a: 'Problem', b: '', c: 'Not recorded', tone: 'grey' }, { a: 'Why now', b: 'Closing moved online.' },
      { a: 'Traction', b: '', c: 'Not recorded', tone: 'grey' }, { a: 'The ask', b: 'Raising a seed round.' },
    ] },
    { key: 'consistency', title: 'Consistency check', rows: [
      { a: 'MRR', b: 'stated $18,400 · metrics $16,950', c: 'Mismatch', tone: 'bad' },
      { a: 'Paying customers', b: 'stated or stored in one place only', c: 'Not compared', tone: 'grey' },
      { a: 'The raise', b: 'stated or stored in one place only', c: 'Not compared', tone: 'grey' },
    ] },
  ],
  side: [], actions: [], activity: [],
});
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'No narrative saved yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function handler(url) {
  if (url.includes('/form-options')) return response(OPTIONS);
  const m = url.match(/\/records\/([^/?]+)\?/);
  if (m) return /^\d+$/.test(m[1]) ? response(version(m[1], `Close the month in a day (v${m[1]}).`)) : response({ detail: 'Not found' }, 404);
  if (url.includes('/cycles/raise/modules/')) return response(MODULE);
  return response({});
}

async function mounted(url, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
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
  // The test DOM keeps no attributes, so each node's React props are read instead.
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  return {
    requests, flush, text: () => text(container),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs are the canvas\'s, less Claims, and only their words are tabs; a version is a number', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [['Home', ''], ['Story', '/story'], ['Positioning', '/positioning'], ['Check', '/check'], ['Versions', '/versions']]);
  for (const word of ['story', 'positioning', 'check', 'versions']) assert.equal(isNarrativeTab('investor-narrative', word), true, word);
  for (const id of ['4', 'new', 'claims', 'home', '']) assert.equal(isNarrativeTab('investor-narrative', id), false, id);
  assert.equal(isNarrativeTab('pitch-deck', 'story'), false, 'only Investor narrative has tabs');
});

test('addresses keep the venture, a tab keeps the chosen version, and a version page drops it', () => {
  assert.equal(tabSearch('?project_id=7&version=4&q=x'), '?project_id=7&version=4');
  assert.equal(tabSearch('?project=7'), '?project_id=7', 'the read\'s own ?project= picks the venture too');
  assert.equal(tabSearch('?project_id=7&version=../x'), '?project_id=7', 'a version is a number');
  assert.equal(tabHref(TABS[1], '?project_id=7', '3'), `${HOME_PATH}/story?project_id=7&version=3`);
  assert.equal(tabHref(TABS[0], '?project_id=7'), `${HOME_PATH}?project_id=7`);
  assert.equal(versionHref('4', '?project_id=7&version=2'), `${HOME_PATH}/4?project_id=7`);
});

test('versions sort newest first; the address\'s version wins only when it is saved', () => {
  const list = versionsOf(OPTIONS);
  assert.deepEqual(list.map((v) => v.value), ['4', '3', '2']);
  assert.deepEqual(versionsOf(null), []);
  assert.deepEqual(versionsOf({ versions: [{ value: 'x', label: 'bad' }, { value: '5', label: '' }] }), []);
  assert.equal(chosenVersion(list, '3'), '3');
  assert.equal(chosenVersion(list, '9'), '4', 'an unsaved version falls back to the newest');
  assert.equal(chosenVersion([], '3'), null);
  assert.equal(previousVersion(list, '4'), '3');
  assert.equal(previousVersion(list, '2'), null);
});

test('the story and the check are the record\'s own words; nothing compared says so', () => {
  const rec = version(4, 'Close the month in a day.');
  assert.deepEqual(storyRows(rec).map((r) => [r.label, r.text]), [
    ['One-liner', 'Close the month in a day.'], ['Problem', null], ['Why now', 'Closing moved online.'], ['Traction', null], ['The ask', 'Raising a seed round.'],
  ]);
  const rows = checkRows(rec);
  assert.deepEqual(rows.map((r) => [r.figure, r.result, r.tone]), [['MRR', 'Mismatch', 'bad'], ['Paying customers', 'Not compared', 'grey'], ['The raise', 'Not compared', 'grey']]);
  assert.equal(rows[0].detail, 'stated $18,400 · metrics $16,950', 'the detail is the Worker\'s sentence, never re-derived');
  assert.equal(checkSummary(rows), '1 compared · 1 mismatch · 2 not compared');
  assert.equal(checkSummary(rows.map((r) => ({ ...r, result: 'Not compared' }))), 'Nothing compared yet.', 'never "no mismatch" when nothing was compared');
  assert.equal(checkSummary([]), null);
  assert.equal(checkRows({ main: [] }).length, 0);
});

test('compare lines up two versions section by section and marks what changed', () => {
  const rows = compareRows(version(4, 'A.'), version(3, 'B.'));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { label: 'One-liner', a: 'A.', b: 'B.', changed: true });
  assert.deepEqual(rows[1], { label: 'Problem', a: null, b: null, changed: false });
});

/* ------------------------------------------------------------------ *
 * Mounted: CycleRoute draws the tabs, and never reads a tab as a record
 * ------------------------------------------------------------------ */

test('Check reads the saved versions and the newest version, never a record called "check"', async () => {
  const view = await mounted('/raise/investor-narrative/check?project_id=3');
  try {
    assert.ok(view.requests.some((u) => u.includes('/cycles/raise/modules/investor-narrative/form-options?project=3')), 'the saved versions');
    assert.ok(view.requests.some((u) => u.includes('/modules/investor-narrative/records/4?project=3')), 'the newest version');
    assert.ok(!view.requests.some((u) => u.includes('/records/check')), 'a tab word is never read as a record');
    const t = view.text();
    assert.match(t, /Check against the metrics/);
    assert.match(t, /1 compared · 1 mismatch · 2 not compared/);
    assert.match(t, /stated \$18,400 · metrics \$16,950/);
    assert.ok(view.testIds().includes('narrative-tabs'));
    assert.ok(view.testIds().includes('cycle-header'), 'the Raise header, with its modules rail, heads the tab');
    for (const href of view.hrefs().filter((x) => x?.startsWith(HOME_PATH))) assert.match(href, /project_id=3/, href);
    assert.doesNotMatch(t, /\[|Northwind/, 'no canvas sample reaches the page');
  } finally { await view.close(); }
});

test('Story reads the version the address names, from the narrative\'s own stores', async () => {
  // D910 (#2694): Story reads D908's sections and bindings, not the record;
  // what it draws is tested in narrative_story_d910.test.mjs.
  const view = await mounted('/raise/investor-narrative/story?project_id=3&version=2');
  try {
    assert.ok(view.requests.some((u) => u.includes('/cycles/raise/narrative/2?project=3')));
    assert.ok(!view.requests.some((u) => u.includes('/cycles/raise/narrative/4?')), 'only the chosen version');
    assert.ok(!view.requests.some((u) => u.includes('/records/2?')), 'Story no longer reads the record');
    assert.ok(view.testIds().includes('narrative-story-page'));
  } finally { await view.close(); }
});

test('Versions lists every version and compares the newest with the one before', async () => {
  const view = await mounted('/raise/investor-narrative/versions?project_id=3');
  try {
    assert.ok(view.requests.some((u) => u.includes('/records/4?project=3')));
    assert.ok(view.requests.some((u) => u.includes('/records/3?project=3')));
    assert.ok(view.testIds().includes('narrative-compare'));
    assert.ok(view.testIds().includes('narrative-compare-changed'), 'the one-liner differs between v4 and v3');
    for (const v of ['4', '3', '2']) assert.ok(view.hrefs().includes(`${HOME_PATH}/${v}?project_id=3`), v);
  } finally { await view.close(); }
});

test('Positioning draws the stored positioning in the tool (D911) and reads no version record', async () => {
  const view = await mounted('/raise/investor-narrative/positioning?project_id=3');
  try {
    assert.ok(view.testIds().includes('narrative-positioning'));
    assert.ok(view.requests.some((u) => u.includes('/narrative/positioning?project=3')));
    assert.ok(!view.hrefs().some((h) => String(h).startsWith('/raise/pitch/positioning')), 'the old address is not linked');
    assert.ok(!view.requests.some((u) => u.includes('/records/')));
  } finally { await view.close(); }
});

test('a numbered address is still the version\'s record page, and Home draws the tabs under its header', async () => {
  const rec = await mounted('/raise/investor-narrative/4?project_id=3');
  try {
    assert.ok(rec.requests.some((u) => u.includes('/records/4?project=3')));
    assert.ok(rec.testIds().includes('cycle-record-page'));
    assert.ok(!rec.testIds().includes('narrative-tabs'), 'a version page is the record, as before');
  } finally { await rec.close(); }
  const home = await mounted('/raise/investor-narrative?project_id=3');
  try {
    assert.ok(home.requests.some((u) => u.includes('/cycles/raise/modules/investor-narrative?project=3')));
    assert.ok(home.testIds().includes('cycle-module') && home.testIds().includes('narrative-tabs'));
  } finally { await home.close(); }
  const other = await mounted('/raise/pitch-deck?project_id=3');
  try {
    assert.ok(!other.testIds().includes('narrative-tabs'), 'only Investor narrative is a tool');
  } finally { await other.close(); }
});

test('no versions offers New version; a failed versions read says so, and reads no record', async () => {
  const none = await mounted('/raise/investor-narrative/story?project_id=3', { handle: (u) => (u.includes('/form-options') ? response({ versions: [] }) : handler(u)) });
  try {
    assert.ok(none.testIds().includes('narrative-no-version'));
    assert.ok(none.hrefs().includes(`${HOME_PATH}/new?project_id=3`), 'New version is the module\'s own Add');
    assert.ok(!none.requests.some((u) => u.includes('/records/')));
  } finally { await none.close(); }
  const failed = await mounted('/raise/investor-narrative/check?project_id=3', { handle: (u) => (u.includes('/form-options') ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    // 2026-10-24 (D906 review): the sentence itself; the rail's own "could not be read" matched before.
    assert.match(failed.text(), /Your narrative versions could not be read\. This is not a claim that none are saved\./);
    assert.ok(!failed.testIds().includes('narrative-loading'), 'a failed read is drawn as still loading');
    assert.doesNotMatch(failed.text(), /Nothing compared yet|No narrative yet/, 'a failed read is not an empty one');
    assert.ok(!failed.requests.some((u) => u.includes('/records/')));
  } finally { await failed.close(); }
});

/* ------------------------------------------------------------------ *
 * The review's fixes (2026-10-24)
 * ------------------------------------------------------------------ */

const answering = (rules) => (u) => { for (const [match, answer] of rules) if (match(u)) return answer(u); return handler(u); };
const isProjects = (u) => /\/api\/projects(\?|$)/.test(u);

test('on a phone, Home keeps the tool\'s tabs when its own read fails', async () => {
  const view = await mounted('/raise/investor-narrative?project_id=3', { phone: true, handle: answering([[(u) => /\/modules\/investor-narrative\?/.test(u), () => response({ detail: 'boom' }, 500)]]) });
  try {
    assert.ok(view.testIds().includes('phone-module'));
    assert.ok(view.testIds().includes('narrative-tabs'), 'the tabs vanish with Home\'s read; their own reads still work');
    assert.match(view.text(), /could not be read/);
  } finally { await view.close(); }
});

test('a tab with no venture list says the list could not be read, never an endless skeleton', async () => {
  const view = await mounted('/raise/investor-narrative/story', { handle: answering([[isProjects, () => response({ detail: 'boom' }, 500)]]) });
  try {
    assert.match(view.text(), /Your ventures could not be read\. This is not a claim that you have none\./);
    assert.ok(!view.testIds().includes('narrative-loading'));
    assert.ok(!view.requests.some((u) => u.includes('/form-options')), 'no versions read without a venture');
  } finally { await view.close(); }
});

test('a refused versions read is the Worker\'s sentence, with no Retry', async () => {
  const view = await mounted('/raise/investor-narrative/check?project_id=9', { handle: answering([[(u) => u.includes('/form-options'), () => response({ detail: 'Forbidden' }, 403)]]) });
  try {
    assert.ok(view.testIds().includes('narrative-refused'));
    assert.match(view.text(), /Forbidden/);
    assert.doesNotMatch(view.text(), /Your narrative versions could not be read/, 'a refusal is drawn as a failed read');
  } finally { await view.close(); }
});

test('Check offers Eadwyn\'s fix only for a mismatch in the newest version', async () => {
  const newest = await mounted('/raise/investor-narrative/check?project_id=3');
  try {
    assert.ok(newest.testIds().includes('narrative-check-fix'), 'v4 has a mismatch: the fix is on Home');
    assert.ok(newest.hrefs().includes(`${HOME_PATH}?project_id=3`));
  } finally { await newest.close(); }
  const older = await mounted('/raise/investor-narrative/check?project_id=3&version=3');
  try {
    assert.ok(!older.testIds().includes('narrative-check-fix'), 'Home phrases the newest version\'s fix, not v3\'s');
    assert.ok(older.testIds().includes('narrative-check-fix-newest'));
  } finally { await older.close(); }
  const noMismatch = await mounted('/raise/investor-narrative/check?project_id=3', { handle: answering([[(u) => /\/records\/4\?/.test(u), () => {
    const rec = version(4, 'A.'); rec.main[1].rows = rec.main[1].rows.map((r) => ({ ...r, c: 'Not compared', tone: 'grey' })); return response(rec);
  }]]) });
  try {
    assert.ok(!noMismatch.testIds().includes('narrative-check-fix'), 'a fix is offered with nothing to fix');
    assert.ok(!noMismatch.testIds().includes('narrative-check-fix-newest'));
  } finally { await noMismatch.close(); }
});

test('the check\'s line says what the Worker compares today, and Home\'s tabs keep the version', async () => {
  // raiseCycle.ts checkInputs also reads the venture profile's MRR, paying customers and funding needed (#2691 narrows it).
  assert.match(CHECK_RUNS, /venture’s profile/);
  assert.doesNotMatch(CHECK_RUNS, /deck side waits/);
  const home = await mounted('/raise/investor-narrative?project_id=3&version=2');
  try {
    assert.ok(home.hrefs().includes(`${HOME_PATH}/check?project_id=3&version=2`), 'Home drops the version the founder was reading');
  } finally { await home.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring and docs
 * ------------------------------------------------------------------ */

test('the wiring: no route is added, CycleRoute branches on the tab word, and the canvas sits in incoming', () => {
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /path="\/raise\/investor-narrative/, 'the tool adds no route; the module routes carry it');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const narrativeTab = record && cycle === 'raise' && isNarrativeTab\(slug, recordId\) \? recordId : null;/);
  assert.match(route, /enabled: record && known && validRecord && !narrativeTab && !!projectId && !!def/);
  // 2026-10-24 (D906 review): Home's tabs keep the address's version, as every other tab page does.
  assert.match(route, /subnav=\{cycle === 'raise' && slug === NARRATIVE \? <NarrativeTabBar active="home" search=\{tabSearch\(q, searchParams\.get\('version'\)\)\} \/> : undefined\}/);
  for (const f of ['Investor Narrative Page.dc.html', 'Investor Narrative · Boards.dc.html']) {
    const src = read(`design/incoming/${f}`);
    assert.match(src, /<script src="\.\/support\.js"><\/script>/, f);
    assert.doesNotMatch(src, /@font-face|__claude_design_branding/, f);
  }
  assert.match(read('design/incoming/Investor Narrative · Boards.dc.html'), /dc-import name="Investor Narrative Page"/);
  assert.ok(existsSync('documentation/architecture/decisions/D906.md'), 'D906 records the integration');
});

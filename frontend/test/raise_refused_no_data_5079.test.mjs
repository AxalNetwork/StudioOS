/**
 * D5079 (#5079) — a refused authoritative read ends the rendering of
 * authoritative data for that tool.
 *
 * `/raise/cap-table` is the module page plus the Cap table tool in its
 * `subnav`. The tool's own read (`GET /api/captable/record/:id`) is gated on
 * `canReadProject`; the module read behind the page (`GET
 * /api/cycles/raise/modules/cap-table`) is gated on `canWrite`. An admin
 * passes the second and not the first, so the page drew the refusal "This cap
 * table belongs to another company." and then, underneath it, "Cap table · at
 * a glance", "No holders yet", a Holders table reading "No records yet",
 * Eadwyn's proposal bands and the Evidence block. "Not allowed to read" was
 * rendered as "read, and empty", which collapses the distinction StudioOS
 * keeps between Not recorded, Unavailable, Refused and a measured zero.
 *
 * The tool now reports its refusal to the page, and the page draws none of
 * the module's authoritative data for it. The tool's own refusal and its tab
 * row stay, because `subnav` sits outside the page's status branch.
 *
 * Every venture, person and figure below is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_refused_no_data_5079.test.mjs
 */
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { OTHER_TITLE } from '../src/pages/raise/captable/overviewModel.js';
import { ROOM_SUMMARY_LINE } from '../src/pages/raise/dataroom/dataRoomModel.js';
import { REFUSED_LINE as CAPREL_REFUSED } from '../src/pages/raise/caprel/capRelModel.js';
import { RAISE_REFUSED_STATUSES, raiseReadState, refusedNoData } from '../src/lib/raiseErrors.js';

const h = React.createElement;
const P = 12;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ADMIN = { id: 9, role: 'admin', subscription_tier: 'studio', name: 'Synthetic Admin' };

/**
 * The module read as the Worker answers it for a principal the module gate
 * lets through: a card and a records table, both empty. These are exactly the
 * blocks that must not be drawn under a refusal.
 */
const moduleRead = (slug, name, recordsTitle) => ({
  module: { slug, name, records_title: recordsTitle },
  card: { slug, name, state: 'empty', range: 'Planned round', reason: 'No holders yet. Ownership before and after the round appears here.' },
  records: { cols: [{ key: 'holder', label: 'Holder' }], rows: [], total: 0, page: 1, page_size: 25 },
});
const EMPTY_RECORD = {
  project_id: P, currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: [] },
  by_holder: { available: false, reason: 'nothing_recorded', rows: [] },
  by_class: { available: false, reason: 'nothing_recorded', rows: [] },
  outstanding: { available: false, reason: 'nothing_recorded' },
  fully_diluted: { available: false, reason: 'nothing_recorded' },
  instruments: { available: true, reason: null, rows: [] },
  issuances: { available: true, reason: null, rows: [] },
  proposals: { available: true, reason: null, rows: [] },
};
const ROOM = { uid: 'room-1', mode: 'full', files: [], access: [], requests: [], checklist: [] };

/**
 * One stubbed Worker. `o` names what each authoritative read answers: a
 * number is that status, anything else is the body.
 */
function handlerFor(o = {}) {
  const at = { record: EMPTY_RECORD, room: ROOM, prospects: { items: [] }, commitments: { totals: {}, round: null }, user: ADMIN, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'That is not yours to read.' }, v) : response(v));
  return (url) => {
    if (url.includes('/auth/me')) return response(at.user);
    if (url.includes('/captable/record/')) return send(at.record);
    if (url.includes('/data-room/')) return send(at.room);
    if (url.includes('/contacts/raise-prospects')) return send(at.prospects);
    if (url.includes('/commitments')) return send(at.commitments);
    if (url.includes('/cycles/raise/modules/cap-table')) return response(moduleRead('cap-table', 'Cap table', 'Holders'));
    if (url.includes('/cycles/raise/modules/data-room')) return response(moduleRead('data-room', 'Data room', 'Files'));
    if (url.includes('/cycles/raise/modules/capital-relationships')) return response(moduleRead('capital-relationships', 'Capital relationships', 'Investors'));
    if (url.includes('/ventures') || url.includes('/projects')) return response({ items: [{ id: P, uid: 'v-12', name: 'Synthetic Venture' }] });
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const handle = handlerFor(o);
  globalThis.fetch = async (u) => handle(String(u));
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(o.user || ADMIN));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  return {
    by: (id) => nodes().find((n) => props(n)['data-testid'] === id),
    // Scoped to one block, so the AI rail's own copy beside the page (which
    // has its own "could not be read") never satisfies or spoils an assertion.
    textIn(id) { const n = nodes().find((x) => props(x)['data-testid'] === id); assert.ok(n, `no ${id}`); return textOf(n).replace(/\s+/g, ' '); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    text: () => textOf(container).replace(/\s+/g, ' '),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/**
 * Everything on the page that speaks for the record: the module's card and
 * its records table, Eadwyn's proposal bands, the Evidence block, the Add and
 * the record counts. Under a refusal every one of them must be absent.
 */
const DATA_BLOCKS = ['cycle-module-chart', 'card-empty', 'cycle-records', 'records-add', 'records-empty', 'records-count',
  'module-evidence', 'module-evidence-open', 'raise-evidence', 'phone-module-chart', 'phone-module-empty'];
/** The bands Eadwyn draws for a Raise module, and the module's Fill control. */
const AI_BLOCKS = ['zone-draft-raise-capital', 'zone-draft-raise-liquidity', 'fill-module', 'fill-proposals'];
const DATA_WORDS = [/· at a glance/, /No holders yet\. Ownership/, /No records yet/, /No files yet/, /Nothing matches this search/];

function assertNoData(view, where, what = null) {
  const ids = view.ids();
  for (const id of [...DATA_BLOCKS, ...AI_BLOCKS]) assert.ok(!ids.includes(id), `${where}: ${id} is still drawn under a refusal`);
  const text = view.text();
  for (const word of DATA_WORDS) assert.doesNotMatch(text, word, `${where}: ${word}`);
  assert.ok(ids.includes('cycle-module-refused'), `${where}: the page does not say the read was refused`);
  // The page says why there is nothing here in its own words, and says plainly
  // that it is not a claim about what is recorded.
  if (what) assert.equal(view.textIn('cycle-module-refused').trim(), refusedNoData(what), where);
}

// ── The contract ────────────────────────────────────────────────────────────

test('a refusal and an unreadable read are different answers, in one place', () => {
  assert.deepEqual([...RAISE_REFUSED_STATUSES], [403, 404]);
  assert.equal(raiseReadState({ status: 403 }), 'refused');
  assert.equal(raiseReadState({ status: 404 }), 'refused', 'a venture outside the caller’s scope answers 404; that is access, not a missing store');
  assert.equal(raiseReadState({ status: 500 }), 'unreadable');
  assert.equal(raiseReadState(new Error('network')), 'unreadable', 'a browser failure is never a refusal');
  assert.equal(raiseReadState({ status: 403 }, 'error'), 'refused');
  assert.equal(raiseReadState({ status: 503 }, 'error'), 'error', 'the caller keeps its own word for a failure');
});

// ── Cap table ───────────────────────────────────────────────────────────────

test('Cap table: a refused record read draws the refusal and none of the module’s data', async () => {
  const view = await mounted(`/raise/cap-table?project_id=${P}`, { record: 403 });
  try {
    assert.ok(view.by('captable-other-company'), 'the tool’s own refusal is drawn');
    assert.match(view.text(), new RegExp(OTHER_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(view.by('cycle-module-refused'), 'the page says the read was refused where its data would be');
    assert.ok(view.by('captable-home'), 'the tool’s own tab row stays: each tab has its own read');
    assert.ok(view.by('captable-tab-overview'), 'and so does its documentation of what Cap table includes');
    for (const id of ['captable-toolbar', 'captable-toolbar-actions', 'captable-propose', 'captable-home-note']) {
      assert.ok(!view.by(id), `${id} speaks for the record, or writes to it, and must not stand above a refusal`);
    }
    assertNoData(view, 'cap table', 'this cap table');
  } finally { await view.close(); }
});

test('Cap table: an empty record read still draws the module’s card and table', async () => {
  const view = await mounted(`/raise/cap-table?project_id=${P}`);
  try {
    assert.ok(!view.by('cycle-module-refused'), 'nothing was refused');
    assert.ok(view.by('cycle-module-chart'), 'a measured empty cap table still shows its card');
    assert.match(view.text(), /· at a glance/);
    assert.match(view.text(), /No holders yet/, 'an empty read is allowed to say it is empty');
  } finally { await view.close(); }
});

test('Cap table: a refusal names the admin’s read-only support door, and a founder’s asks for access', async () => {
  const admin = await mounted(`/raise/cap-table?project_id=${P}`, { record: 403 });
  try {
    assert.ok(admin.by('captable-other-company-support'), 'an admin is given the reason-gated door');
    assert.match(admin.text(), /Open for support, with a reason/);
  } finally { await admin.close(); }
  const founder = await mounted(`/raise/cap-table?project_id=${P}`, { record: 403, user: { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio' } });
  try {
    assert.ok(!founder.by('captable-other-company-support'), 'a founder has no support path, so none is offered');
    assertNoData(founder, 'cap table, founder', 'this cap table');
  } finally { await founder.close(); }
});

test('Cap table: a failed record read is still a failure, with its data blocks withheld but no refusal', async () => {
  const view = await mounted(`/raise/cap-table?project_id=${P}`, { record: 500 });
  try {
    assert.ok(view.by('captable-record-unreadable'), 'a 500 says the read failed');
    assert.ok(!view.by('cycle-module-refused'), 'a failure is not a refusal');
    assert.ok(!view.by('captable-other-company'), 'a failure never claims another company');
  } finally { await view.close(); }
});

// ── Data room ───────────────────────────────────────────────────────────────

test('Data room: a refused room read draws the refusal and none of the module’s data', async () => {
  const view = await mounted(`/raise/data-room?project_id=${P}`, { room: 403 });
  try {
    assert.ok(view.by('dataroom-home-refused'), 'the tool’s own refusal is drawn');
    assert.ok(view.by('cycle-module-refused'));
    assertNoData(view, 'data room', 'this data room');
  } finally { await view.close(); }
});

test('Data room: a summary answer is not the room, so no empty room is drawn', async () => {
  const view = await mounted(`/raise/data-room?project_id=${P}`, { room: { ...ROOM, mode: 'summary' } });
  try {
    assert.ok(view.by('dataroom-home-summary'), 'Home says the room is not theirs to read, rather than nothing');
    assert.match(view.text(), new RegExp(ROOM_SUMMARY_LINE.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(view.by('dataroom-home-summary-open'), 'the reason gate is one press away');
    assert.ok(view.by('cycle-module-refused'));
    assertNoData(view, 'data room, summary', 'this data room');
  } finally { await view.close(); }
});

// ── Capital relationships ───────────────────────────────────────────────────

test('Capital relationships: a refusal is drawn as a refusal, never as an unreadable store', async () => {
  const view = await mounted(`/raise/capital-relationships?project_id=${P}`, { prospects: 403 });
  try {
    assert.ok(view.by('caprel-overview-refused'), 'the tool’s own refusal is drawn');
    assert.match(view.text(), new RegExp(CAPREL_REFUSED.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(view.textIn('caprel-overview'), /could not be read/, 'a refusal is not a claim that the read failed');
    assert.ok(view.by('cycle-module-refused'));
    assertNoData(view, 'capital relationships', 'this venture’s capital relationships');
  } finally { await view.close(); }
});

test('Capital relationships: a refused round alone is that block’s refusal, not the tool’s', async () => {
  // The viewer may read the pipeline and not the round. Saying the whole tool
  // is not theirs to read would be false, and saying the round could not be
  // read would be a claim about the store.
  const db = await mounted(`/raise/capital-relationships?project_id=${P}`, { commitments: 403 });
  try {
    assert.ok(db.by('caprel-ov-round-refused'), 'the round says it was refused');
    assert.ok(!db.by('caprel-overview-refused'), 'the tool is not refused');
    assert.ok(!db.by('cycle-module-refused'), 'so the page still draws the module');
    assert.doesNotMatch(db.textIn('caprel-ov-round'), /could not be read/, 'a refusal is not a failed read');
    assert.doesNotMatch(db.textIn('caprel-ov-round'), /not yours to read\. Switch company/, 'the whole tool is not claimed');
  } finally { await db.close(); }
});

test('Capital relationships: a failed prospects read still says the read failed', async () => {
  const view = await mounted(`/raise/capital-relationships?project_id=${P}`, { prospects: 500 });
  try {
    assert.ok(!view.by('caprel-overview-refused'), 'a 500 is not a refusal');
    assert.match(view.textIn('caprel-overview'), /This is not a claim that nothing needs you/);
  } finally { await view.close(); }
});

// ── Mutation and restoration ────────────────────────────────────────────────

/**
 * Each guarded line is broken on disk and this file is re-run in a child
 * process, filtered to the tests that must then fail. Rebinding the modules in
 * memory is not enough: the refusal travels from a tool's own read, through
 * `CycleRoute`, into the module page, so only a real import of the mutated
 * tree exercises it. The source is restored in a `finally`.
 */
const SELF = new URL(import.meta.url).pathname;
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  return env;
}
const run = (pattern) => spawnSync(process.execPath,
  ['--import', './frontend/test/_deck-loader.mjs', '--test', '--test-name-pattern', pattern, SELF],
  { cwd: process.cwd(), encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...childEnv(), D5079_SKIP_MUTATIONS: '1' } });

const CHECKS = [
  { name: 'a refused tool read makes the page refuse', file: 'frontend/src/pages/cycles/CycleRoute.jsx',
    before: "  const refusedTool = !record && toolRefusal?.refused ? toolRefusal : null;",
    after: '  const refusedTool = null;', pattern: 'none of the module’s data' },
  { name: 'the page draws the refusal where its data would be', file: 'frontend/src/pages/cycles/CycleRoute.jsx',
    before: "        status={projectStatus === 'unreadable' ? 'unreadable' : refusedTool ? 'refused' : moduleStatus}",
    after: "        status={projectStatus === 'unreadable' ? 'unreadable' : moduleStatus}", pattern: 'none of the module’s data' },
  { name: 'the cap table reports its refusal', file: 'frontend/src/pages/raise/captable/CapTableOverview.jsx',
    before: "  useEffect(() => { onRefused?.(raiseToolRefusal(refused, 'this cap table')); }, [onRefused, refused]);",
    after: '', pattern: 'Cap table: a refused record read' },
  { name: 'the cap table withholds its tool bar and its write', file: 'frontend/src/pages/raise/captable/CapTableOverview.jsx',
    before: '      {refused ? null : <ToolBar record={record}',
    after: '      {false ? null : <ToolBar record={record}', pattern: 'Cap table: a refused record read' },
  { name: 'the cap table offers the admin their door', file: 'frontend/src/pages/raise/captable/CapTableOverview.jsx',
    before: '{admin ? <Link className={GHOST} to={`/cap-tables/${encodeURIComponent(String(projectId))}`} data-testid="captable-other-company-support">Open for support, with a reason</Link>',
    after: '{false ? <Link className={GHOST} to="/" data-testid="captable-other-company-support">Open for support, with a reason</Link>',
    pattern: 'read-only support door' },
  { name: 'the data room reports a refusal and a summary alike', file: 'frontend/src/pages/raise/dataroom/DataRoomTool.jsx',
    before: "  useEffect(() => { onRefused?.(raiseToolRefusal(withheld, 'this data room')); }, [onRefused, withheld]);",
    after: '', pattern: 'Data room' },
  { name: 'the data room’s Home says a summary is not the room', file: 'frontend/src/pages/raise/dataroom/DataRoomHome.jsx',
    before: "  if (read.room?.mode === 'summary') {", after: "  if (read.room?.mode === 'summary') { return null; }\n  if (false) {",
    pattern: 'a summary answer is not the room' },
  { name: 'the pipeline tells a refusal from a failure', file: 'frontend/src/pages/raise/caprel/CapRelPipeline.jsx',
    before: "setRead({ status: raiseReadState(error), items: null, projectId, message: userFacingRaiseError(error, { fallback: '' }) })",
    after: "setRead({ status: 'unreadable', items: null, projectId })", pattern: 'never as an unreadable store' },
  { name: 'the pipeline reports its refusal', file: 'frontend/src/pages/raise/caprel/CapRelOverview.jsx',
    before: "  useEffect(() => { onRefused?.(raiseToolRefusal(refused, 'this venture’s capital relationships')); }, [onRefused, refused]);",
    after: '', pattern: 'never as an unreadable store' },
  { name: 'one refused block is that block’s refusal', file: 'frontend/src/pages/raise/caprel/CapRelOverview.jsx',
    before: '      {read.status === \'refused\' ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid="caprel-ov-round-refused">{ROUND_REFUSED_LINE}</p> : null}',
    after: '', pattern: 'that block’s refusal' },
  { name: '403 and 404 are both refusals', file: 'frontend/src/lib/raiseErrors.js',
    before: 'export const RAISE_REFUSED_STATUSES = Object.freeze([403, 404]);',
    after: 'export const RAISE_REFUSED_STATUSES = Object.freeze([403]);', pattern: 'different answers, in one place' },
];

if (!process.env.D5079_SKIP_MUTATIONS) {
  test('every check’s tests pass against the source before any mutation', () => {
    for (const pattern of new Set(CHECKS.map((c) => c.pattern))) {
      const r = run(pattern);
      assert.equal(r.status, 0, `${pattern} did not pass unmutated: ${(r.stdout || '').slice(-1800)}`);
      assert.match(r.stdout || '', /# fail 0/, pattern);
      assert.doesNotMatch(r.stdout || '', /# pass 0\n/, `${pattern} matched no test`);
    }
  });

  for (const check of CHECKS) test(`Mutation and restoration: ${check.name}`, () => {
    const original = readFileSync(check.file, 'utf8');
    assert.ok(original.includes(check.before), `mutation_target_missing: ${check.name}`);
    assert.equal(original.split(check.before).length - 1, 1, `mutation target is not unique: ${check.name}`);
    let result;
    try {
      writeFileSync(check.file, original.replace(check.before, check.after));
      result = run(check.pattern);
    } finally { writeFileSync(check.file, original); }
    assert.notEqual(result.status, 0, `the mutation went unnoticed by "${check.pattern}": ${(result.stdout || '').slice(-1800)}`);
    assert.equal(readFileSync(check.file, 'utf8'), original, 'the source was not restored');
  });
}

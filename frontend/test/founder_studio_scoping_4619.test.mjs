// D4619 (#4619, Studio audit 1/5): the founder Studio's venture context.
// Deferred responses drive the real hook (`useFounderCycleReads`, mounted with React) and the real reads
// (`startFounderStudioReads`); only the network is stubbed. Nothing here asserts source text.
//
//   · a cycle read is kept under the full venture + cycle key: A → B → A asks again for A and never shows B's under A;
//   · a delayed success or failure for A that lands after B is selected changes nothing on B;
//   · only the latest request for a venture and cycle may land: an answer from an earlier visit or a retried read is dropped;
//   · a supplied project ID the member cannot open is an unavailable-venture state, never another venture;
//   · with no ID supplied, the first accessible venture is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, textOf } from './_form_d695.mjs';
import { useFounderCycleReads } from '../src/pages/founder/useFounderCycleReads.js';
import { startFounderStudioReads } from '../src/pages/founder/founderStudioReads.js';
import FounderStudioBody from '../src/pages/founder/FounderStudioBody.jsx';
import { studioFromReads } from '../src/pages/studio/useStudioLayout.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const stateOf = (r) => (r === undefined ? 'loading' : r.failed ? `failed:${r.failed}` : r.noProject ? 'none' : `ok:${r.marker}`);

function Probe({ project, placed }) {
  const { reads, retry } = useFounderCycleReads(project, placed);
  return h('div', null,
    ...placed.map((cycle) => h('span', { key: cycle, 'data-testid': `cycle-${cycle}` }, stateOf(reads[cycle]))),
    h('button', { onClick: () => retry(placed[0]) }, 'Retry'));
}

/** Mounts the hook with every overview read held open; `take(projectId)` hands over the oldest open read for that venture. */
async function mountHook(project, placed = ['validate']) {
  const before = globalThis.fetch;
  const open = [];
  const log = [];
  globalThis.fetch = (url) => {
    const path = String(url).replace(/^.*\/api/, '');
    const g = deferred();
    log.push(path);
    open.push({ path, g });
    return g.promise;
  };
  const m = await mountForm(h(Probe, { project, placed }));
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  const take = (projectId) => {
    const at = open.findIndex((o) => new URLSearchParams(o.path.split('?')[1]).get('project') === String(projectId));
    assert.ok(at >= 0, `an overview read is open for venture ${projectId}: ${log.join(', ')}`);
    return open.splice(at, 1)[0].g;
  };
  return {
    m, log, settle,
    show: async (next) => { await m.render(h(Probe, { project: next, placed })); await settle(); },
    cell: (cycle = 'validate') => textOf(m.by(`cycle-${cycle}`)),
    take,
    async close() { await m.unmount(); globalThis.fetch = before; },
  };
}

const A = { id: 11, name: 'Venture A' };
const B = { id: 22, name: 'Venture B' };

test('A → B → A: B never shows A\'s cycle read, and returning to A asks again for A', async () => {
  const t = await mountHook(A);
  const quiet = console.error; console.error = () => {};
  try {
    const firstA = t.take(11);
    // The home resets its reads on a project change, so the venture is loading between A and B.
    await t.show(undefined);
    await t.show(B);
    const firstB = t.take(22);
    assert.equal(t.cell(), 'loading', 'B is loading, not drawn with A\'s read');
    firstA.resolve(reply({ marker: 'A' }));
    await t.settle();
    // Mutation checked: storing and reading the answer under the cycle alone, committed without the context/token check (the
    // pre-#4619 hook), shows "ok:A" here; restored, it passes.
    assert.equal(t.cell(), 'loading', 'A\'s late answer is not drawn under B');
    firstB.resolve(reply({ marker: 'B' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:B');
    await t.show(undefined);
    await t.show(A);
    // Mutation checked: keeping the reads across a context change and reading them by cycle alone shows "ok:B" here; restored, it passes.
    assert.equal(t.cell(), 'loading', 'back on A, B\'s read is not drawn under A');
    // Mutation checked: keeping the request map across contexts skips this request, and take(11) fails; restored, it passes.
    const secondA = t.take(11);
    secondA.resolve(reply({ marker: 'A2' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:A2', 'A is read again and drawn with A\'s own answer');
  } finally { console.error = quiet; await t.close(); }
});

test('a delayed failure for A that lands after B is selected leaves B as it is', async () => {
  const t = await mountHook(A);
  const quiet = console.error; console.error = () => {};
  try {
    const lateA = t.take(11);
    await t.show(undefined);
    await t.show(B);
    t.take(22).resolve(reply({ marker: 'B' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:B');
    lateA.resolve(reply({ error: 'down', message: 'A is down.' }, 503));
    await t.settle();
    // Mutation checked: the cycle-only key with no context/token check in `commit` turns this into "failed:A is down."; restored, it passes.
    assert.equal(t.cell(), 'ok:B', 'A\'s failure is obsolete and is dropped');
  } finally { console.error = quiet; await t.close(); }
});

test('a delayed success for A that lands while B is still loading is dropped, and B\'s own failure is B\'s', async () => {
  const t = await mountHook(A);
  const quiet = console.error; console.error = () => {};
  try {
    const lateA = t.take(11);
    await t.show(B);
    const b = t.take(22);
    lateA.resolve(reply({ marker: 'A' }));
    await t.settle();
    // Mutation checked: the cycle-only key with no context/token check shows "ok:A" here; restored, it passes.
    assert.equal(t.cell(), 'loading');
    b.resolve(reply({ error: 'down', message: 'B is down.' }, 503));
    await t.settle();
    assert.match(t.cell(), /^failed:/, 'B\'s own failure is drawn on B');
    // A Retry supersedes the failed read; its answer is B's.
    await t.m.click('Retry');
    await t.settle();
    assert.equal(t.cell(), 'loading');
    t.take(22).resolve(reply({ marker: 'B2' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:B2');
  } finally { console.error = quiet; await t.close(); }
});

test('back on A, a late answer from A\'s first visit cannot replace the answer read on return', async () => {
  const t = await mountHook(A);
  const quiet = console.error; console.error = () => {};
  try {
    const firstA = t.take(11);
    await t.show(undefined);
    await t.show(B);
    t.take(22).resolve(reply({ marker: 'B' }));
    await t.settle();
    await t.show(undefined);
    await t.show(A);
    const secondA = t.take(11);
    secondA.resolve(reply({ marker: 'A2' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:A2');
    firstA.resolve(reply({ error: 'down', message: 'A was down.' }, 503));
    await t.settle();
    // Mutation checked: committing whenever the hook is mounted (dropping the context and latest-request check in `commit`,
    // while keeping the context in the key) turns this into "failed:A was down."; restored, it passes.
    assert.equal(t.cell(), 'ok:A2', 'the first visit\'s read is obsolete: the read made on return owns A');
  } finally { console.error = quiet; await t.close(); }
});

test('after Retry, the superseded read\'s late answer cannot replace the retried one', async () => {
  const t = await mountHook(B);
  const quiet = console.error; console.error = () => {};
  try {
    const first = t.take(22);
    await t.m.click('Retry');
    await t.settle();
    const second = t.take(22);
    second.resolve(reply({ marker: 'B2' }));
    await t.settle();
    assert.equal(t.cell(), 'ok:B2');
    first.resolve(reply({ marker: 'B-old' }));
    await t.settle();
    // Mutation checked: the same mounted-only `commit` draws "ok:B-old" here; restored, it passes.
    assert.equal(t.cell(), 'ok:B2', 'only the latest request for a venture and cycle may land');
  } finally { console.error = quiet; await t.close(); }
});

// ── the venture the page reads ─────────────────────────────────────────────

function world(projects) {
  const calls = [];
  const client = {
    listProjects: async () => { calls.push('projects'); return projects; },
    getLifecycle: async (id) => { calls.push(`lifecycle:${id}`); return { stage: 'x' }; },
    getScores: async (id) => { calls.push(`scores:${id}`); return []; },
    advisor: { progress: async () => ({}), queue: async () => ({}) },
  };
  const lab = { state: async () => ({}) };
  const reads = {};
  const run = (requestedProjectId) => startFounderStudioReads({ requestedProjectId, client, lab, onRead: (k, v) => { reads[k] = v; } });
  return { calls, reads, run };
}

const MODULES = { profile: 'founder', groups: [{ key: 'studio', label: 'Studio' }], modules: [
  { key: 'company_progress', title: 'Company progress', group: 'studio', purpose: 'p', href: null, default_size: 'full', in_default: true, locked_by_plan: false, plan: null },
] };
const LAYOUT = { profile: 'founder', source: 'default', layout: [{ key: 'company_progress', size: 'full' }], revision: null, updated_at: null, dropped: [] };

test('a supplied project ID the member cannot open is unavailable, never another venture', async () => {
  const w = world([{ id: 3, name: 'Accessible venture' }, { id: 4, name: 'Second venture' }]);
  await w.run('9');
  // Mutation checked: restoring the `|| list.find((p) => p?.id)` fallback reads venture 3 here; restored, it passes.
  assert.equal(w.reads.project.unavailable, '9', 'the venture read says which ID was not available');
  assert.match(w.reads.project.failed, /not available/);
  for (const key of ['lifecycle', 'scores']) assert.equal(w.reads[key], w.reads.project, `${key} says the same, not another venture's`);
  assert.deepEqual(w.calls.filter((c) => c !== 'projects'), [], 'nothing is read for another venture');

  // The page draws the unavailable state, and nothing from the accessible venture.
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(FounderStudioBody, {
    user: { name: 'Synthetic Founder' }, reads: { ...w.reads, lab: {}, advisor: {}, queue: {} }, onRetry: () => {},
    studio: studioFromReads({ profile: 'founder', viewer: { name: 'Synthetic Founder' }, modules: MODULES, layout: LAYOUT }),
  })));
  // Mutation checked: removing `<ProjectUnavailable />` from FounderStudioBody fails this; restored, it passes.
  assert.match(html, /data-testid="status-founder-project-unavailable"/);
  assert.doesNotMatch(html, /Accessible venture|Second venture/);

  // And the cycle reads say so too, without a request.
  const t = await mountHook(w.reads.project);
  try {
    // Mutation checked: giving the unavailable venture the generic 'could not be read' reason fails this; restored, it passes.
    assert.equal(t.cell(), 'failed:This venture is not available to your account.');
    assert.equal(t.log.length, 0, 'no overview is read for an unavailable venture');
  } finally { await t.close(); }
});

test('a supplied ID the member can open is read; with no ID the first accessible venture is', async () => {
  let w = world([{ id: 3, name: 'First' }, { id: 7, name: 'Requested' }]);
  await w.run('7');
  assert.equal(w.reads.project.name, 'Requested');
  assert.ok(w.calls.includes('lifecycle:7'));
  for (const none of [null, '']) {
    w = world([{ name: 'No id' }, { id: 5, name: 'Accessible' }]);
    await w.run(none);
    // Mutation checked: treating '' as a supplied ID makes it unavailable here; restored, it passes.
    assert.equal(w.reads.project?.name, 'Accessible', `no ID (${JSON.stringify(none)}) reads the first accessible venture`);
    assert.ok(w.calls.includes('lifecycle:5'));
  }
  w = world([]);
  await w.run(null);
  assert.equal(w.reads.project, null, 'no venture at all is none, not unavailable');
});

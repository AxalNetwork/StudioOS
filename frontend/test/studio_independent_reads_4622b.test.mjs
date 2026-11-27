// #4622 (Studio audit 4/5): independent reads and one owner for shared requests.
// Deferred responses drive every case; nothing here asserts source text.
//
//   · each founder Studio read is committed when it settles, not when the slowest has;
//   · the venture's lifecycle and scores start as soon as the projects read answers, not after the advisor or queue;
//   · a failed read is that zone's own failure and holds nothing else back;
//   · two callers of the advisor progress or queue read while one is in flight share a request; nothing is kept
//     once it settles; a failure is not remembered; another identity never shares a read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { startFounderStudioReads } from '../src/pages/founder/founderStudioReads.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function world() {
  const d = { projects: deferred(), lab: deferred(), advisor: deferred(), queue: deferred(), lifecycle: deferred(), scores: deferred() };
  const calls = [];
  const client = {
    listProjects: () => { calls.push('projects'); return d.projects.promise; },
    getLifecycle: (id) => { calls.push(`lifecycle:${id}`); return d.lifecycle.promise; },
    getScores: (id) => { calls.push(`scores:${id}`); return d.scores.promise; },
    advisor: { progress: () => { calls.push('advisor'); return d.advisor.promise; }, queue: () => { calls.push('queue'); return d.queue.promise; } },
  };
  const lab = { state: () => { calls.push('lab'); return d.lab.promise; } };
  const committed = [];
  const run = (requestedProjectId) => startFounderStudioReads({ requestedProjectId, client, lab, onRead: (key, value) => committed.push([key, value]) });
  return { d, calls, committed, run, keys: () => committed.map(([k]) => k) };
}

test('the four independent reads start together, and each is committed the moment it settles', async () => {
  const w = world();
  const done = w.run(null);
  await tick();
  assert.deepEqual([...w.calls].sort(), ['advisor', 'lab', 'projects', 'queue'], 'all four started before any answered');
  w.d.lab.resolve({ active: true });
  await tick();
  assert.deepEqual(w.keys(), ['lab'], 'the Lab is on the page while the others are still loading');
  w.d.queue.resolve({ queue: [] });
  await tick();
  assert.deepEqual(w.keys(), ['lab', 'queue']);
  w.d.advisor.resolve({ total: 3 }); w.d.projects.resolve([]);
  await done;
  assert.deepEqual(new Set(w.keys()), new Set(['lab', 'queue', 'advisor', 'project', 'lifecycle', 'scores']));
});

test('the venture\'s lifecycle and scores start when projects answers, not after the advisor or the queue', async () => {
  const w = world();
  const done = w.run('7');
  await tick();
  w.d.projects.resolve([{ id: 3, name: 'First' }, { id: 7, name: 'Requested' }]);
  await tick();
  // The advisor, queue and Lab have not answered, and the dependent reads are already out, for the requested venture.
  assert.ok(w.calls.includes('lifecycle:7') && w.calls.includes('scores:7'), `dependent reads started: ${w.calls}`);
  assert.deepEqual(w.committed.find(([k]) => k === 'project')[1], { id: 7, name: 'Requested' });
  assert.equal(w.keys().includes('advisor'), false);
  w.d.lifecycle.resolve({ stage: 'x' });
  await tick();
  assert.ok(w.keys().includes('lifecycle'), 'lifecycle is committed while the advisor is still pending');
  assert.equal(w.keys().includes('scores'), false);
  w.d.scores.resolve([]); w.d.lab.resolve({}); w.d.advisor.resolve({}); w.d.queue.resolve({});
  await done;
});

test('with no venture requested the first one is read; none at all is null, not a failure', async () => {
  let w = world();
  let done = w.run(null);
  w.d.projects.resolve({ projects: [{ id: 5, name: 'Only' }] });
  await tick();
  assert.ok(w.calls.includes('lifecycle:5'));
  w.d.lifecycle.resolve({}); w.d.scores.resolve([]); w.d.lab.resolve({}); w.d.advisor.resolve({}); w.d.queue.resolve({});
  await done;
  w = world();
  done = w.run(null);
  w.d.projects.resolve([]);
  w.d.lab.resolve({}); w.d.advisor.resolve({}); w.d.queue.resolve({});
  await done;
  assert.deepEqual(w.committed.filter(([k]) => ['project', 'lifecycle', 'scores'].includes(k)), [['project', null], ['lifecycle', null], ['scores', null]]);
  assert.equal(w.calls.some((c) => c.startsWith('lifecycle') || c.startsWith('scores')), false, 'nothing to read for a venture that does not exist');
});

test('a failed read is that zone\'s own failure and holds nothing else back', async () => {
  const w = world();
  const done = w.run(null);
  w.d.advisor.reject(new Error('advisor down'));
  await tick();
  const advisor = w.committed.find(([k]) => k === 'advisor')[1];
  assert.equal(advisor.failed, 'advisor down');
  w.d.projects.resolve([{ id: 2, name: 'V' }]); w.d.lab.resolve({ ok: 1 }); w.d.queue.resolve({}); w.d.lifecycle.resolve({}); w.d.scores.resolve([]);
  await done;
  assert.deepEqual(w.committed.find(([k]) => k === 'lab')[1], { ok: 1 }, 'a failed advisor read did not touch the Lab');
  assert.deepEqual(w.committed.find(([k]) => k === 'project')[1], { id: 2, name: 'V' }, 'nor the venture');

  const failed = world();
  const run2 = failed.run(null);
  failed.d.projects.reject(new Error('projects down'));
  failed.d.lab.resolve({}); failed.d.advisor.resolve({}); failed.d.queue.resolve({});
  await run2;
  for (const key of ['project', 'lifecycle', 'scores']) assert.equal(failed.committed.find(([k]) => k === key)[1].failed, 'projects down', `${key} says the venture could not be read`);
  assert.equal(failed.calls.some((c) => c.startsWith('lifecycle')), false);
});

// ── the shared in-flight read ───────────────────────────────────────────────

const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function withApi(fn) {
  const restore = installDocument();
  const before = globalThis.fetch;
  const { api } = await import('../src/lib/api.js');
  const log = [];
  const gates = [];
  globalThis.fetch = (url, opts = {}) => {
    const g = deferred();
    log.push({ path: String(url).replace(/^.*\/api/, ''), auth: opts.headers?.Authorization ?? null });
    gates.push(g);
    return g.promise;
  };
  try { await fn({ api, log, gates }); } finally { globalThis.fetch = before; restore(); }
}

test('callers asking while a progress read is in flight share one request; nothing is kept once it settles', async () => {
  await withApi(async ({ api, log, gates }) => {
    globalThis.localStorage.setItem('token', 'token-a');
    const a = api.advisor.progress(); const b = api.advisor.progress(); const c = api.advisor.progress();
    await tick();
    assert.equal(log.length, 1, 'the founder home, the interview wrapper and the profile card are one request');
    gates[0].resolve(reply({ total: 4 }));
    const results = await Promise.all([a, b, c]);
    assert.deepEqual(results.map((r) => r.total), [4, 4, 4]);
    const later = api.advisor.progress();
    await tick();
    assert.equal(log.length, 2, 'a read after it settled asks again: a retry, or a read after an answer, is never stale');
    gates[1].resolve(reply({ total: 5 }));
    assert.equal((await later).total, 5);
  });
});

test('a failed shared read is not remembered, and the next call asks again', async () => {
  await withApi(async ({ api, log, gates }) => {
    globalThis.localStorage.setItem('token', 'token-a');
    const first = api.advisor.queue(); const second = api.advisor.queue();
    await tick();
    assert.equal(log.length, 1);
    gates[0].resolve(reply({ error: 'down', message: 'Down.' }, 503));
    const outcomes = await Promise.allSettled([first, second]);
    assert.deepEqual(outcomes.map((o) => o.status), ['rejected', 'rejected'], 'every sharer sees the failure');
    const retry = api.advisor.queue();
    await tick();
    assert.equal(log.length, 2, 'the failure was not cached');
    gates[1].resolve(reply({ queue: [] }));
    assert.deepEqual(await retry, { queue: [] });
  });
});

test('another identity, and another read, never share a request', async () => {
  await withApi(async ({ api, log, gates }) => {
    globalThis.localStorage.setItem('token', 'token-a');
    const a = api.advisor.progress();
    globalThis.localStorage.setItem('token', 'token-b');
    const b = api.advisor.progress();
    const q = api.advisor.queue();
    const focused = api.advisor.queue('profile');
    await tick();
    assert.equal(log.length, 4, 'two members, and the queue and its focused form, are four reads');
    assert.deepEqual(log.filter((l) => l.path === '/advisor/progress').map((l) => l.auth).sort(), ['Bearer token-a', 'Bearer token-b']);
    gates.forEach((g) => g.resolve(reply({})));
    await Promise.all([a, b, q, focused]);
  });
});

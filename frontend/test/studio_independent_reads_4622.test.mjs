// D4622 (#4622), layout half: the catalogue and the saved layout read together, commit on their own, and retry on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm } from './_form_d695.mjs';
import { useStudioLayout } from '../src/pages/studio/useStudioLayout.js';
import { StudioLayoutNotice } from '../src/pages/studio/StudioParts.jsx';
import { studioFromReads } from '../src/pages/studio/useStudioLayout.js';

const L = (rev, keys) => ({ source: 'saved', revision: rev, layout: keys.map((key) => ({ key, size: '1/2' })), dropped: [], updated_at: 'x' });
const CAT = { modules: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], groups: [] };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function deferredApi() {
  const calls = { modules: [], layout: [], save: [] };
  return {
    calls,
    modules: (p) => { const d = deferred(); calls.modules.push({ p, ...d }); return d.promise; },
    layout: (p) => { const d = deferred(); calls.layout.push({ p, ...d }); return d.promise; },
    saveLayout: () => { const d = deferred(); calls.save.push(d); return d.promise; },
    resetLayout: async () => L(9, []),
  };
}
async function mountHook(api, viewer = { role: 'founder' }) {
  const box = {};
  const Probe = () => { box.s = useStudioLayout({ profile: 'founder', viewer, api }); return null; };
  const m = await mountForm(h(Probe));
  await m.flush();
  return { m, box };
}
const run = (fn) => act(async () => { await fn(); });

test('both reads start together, and the layout draws before the catalogue answers', async () => {
  const api = deferredApi();
  const { m, box } = await mountHook(api);
  assert.deepEqual([api.calls.modules.length, api.calls.layout.length], [1, 1], 'one request each, started together');
  assert.deepEqual([box.s.layoutRead, box.s.modulesRead], ['loading', 'loading']);
  await run(() => api.calls.layout[0].resolve(L(1, ['a'])));
  assert.equal(box.s.layoutRead, 'ready', 'the layout is not held for the catalogue');
  assert.equal(box.s.modulesRead, 'loading');
  assert.deepEqual(box.s.placed.map((t) => t.key), ['a']);
  assert.equal(box.s.canCustomise, false, 'Customise waits for the catalogue');
  await run(() => api.calls.modules[0].resolve(CAT));
  assert.equal(box.s.canCustomise, true);
  await m.unmount();
});

test('the catalogue answering first does not wait for the layout either', async () => {
  const api = deferredApi();
  const { m, box } = await mountHook(api);
  await run(() => api.calls.modules[0].resolve(CAT));
  assert.deepEqual([box.s.modulesRead, box.s.layoutRead], ['ready', 'loading']);
  await run(() => api.calls.layout[0].reject(new Error('down')));
  assert.equal(box.s.layoutRead, 'failed');
  assert.equal(box.s.modulesRead, 'ready', 'a failed layout read leaves the catalogue as read');
  await m.unmount();
});

test('a failed catalogue keeps the layout, and its retry reads only the catalogue', async () => {
  const api = deferredApi();
  const { m, box } = await mountHook(api);
  await run(() => api.calls.layout[0].resolve(L(1, ['a'])));
  await run(() => api.calls.modules[0].reject(new Error('down')));
  assert.equal(box.s.modulesRead, 'failed');
  assert.deepEqual(box.s.placed.map((t) => t.key), ['a'], 'the layout stays');
  await run(() => box.s.reloadModules());
  await m.flush();
  assert.deepEqual([api.calls.modules.length, api.calls.layout.length], [2, 1], 'only the catalogue was asked again');
  assert.equal(box.s.layoutRead, 'ready', 'the layout never went back to loading');
  await run(() => api.calls.modules[1].resolve(CAT));
  assert.equal(box.s.modulesRead, 'ready');
  await m.unmount();
});

test('a failed layout retries on its own, and the catalogue is not re-read', async () => {
  const api = deferredApi();
  const { m, box } = await mountHook(api);
  await run(() => api.calls.modules[0].resolve(CAT));
  await run(() => api.calls.layout[0].reject(new Error('down')));
  await run(() => box.s.reload());
  await m.flush();
  assert.deepEqual([api.calls.modules.length, api.calls.layout.length], [1, 2]);
  assert.equal(box.s.modulesRead, 'ready');
  await run(() => api.calls.layout[1].resolve(L(1, ['b'])));
  assert.deepEqual(box.s.placed.map((t) => t.key), ['b']);
  await m.unmount();
});

test('a catalogue retry does not disturb a save in flight', async () => {
  const api = deferredApi();
  const { m, box } = await mountHook(api);
  await run(() => api.calls.layout[0].resolve(L(1, ['a'])));
  await run(() => api.calls.modules[0].resolve(CAT));
  await run(() => box.s.customise());
  await run(() => box.s.edit.add({ key: 'b' }));
  let saved;
  await act(async () => { saved = box.s.done(); });
  await run(() => box.s.reloadModules());
  await run(() => api.calls.save[0].resolve(L(2, ['a', 'b'])));
  await act(async () => { await saved; });
  assert.equal(box.s.saving, 'saved', 'the save still lands: a catalogue retry is not a layout reload');
  assert.deepEqual(box.s.placed.map((t) => t.key), ['a', 'b']);
  await m.unmount();
});

test('a late answer from before a profile change is dropped by each read', async () => {
  const api = deferredApi();
  const box = {};
  let prof = 'founder';
  const Probe = ({ p }) => { box.s = useStudioLayout({ profile: p, viewer: { role: 'admin' }, api }); return null; };
  const m = await mountForm(h(Probe, { p: prof }));
  await m.flush();
  await m.render(h(Probe, { p: 'investor' }));
  await m.flush();
  assert.deepEqual([api.calls.modules.length, api.calls.layout.length], [2, 2]);
  assert.deepEqual(api.calls.layout.map((c) => c.p), ['founder', 'investor']);
  await run(() => api.calls.layout[0].resolve(L(1, ['a'])));
  await run(() => api.calls.modules[0].resolve({ modules: [{ key: 'a', title: 'A' }], groups: [] }));
  assert.deepEqual([box.s.layoutRead, box.s.modulesRead], ['loading', 'loading'], 'the founder answers draw nothing for the investor');
  await run(() => api.calls.layout[1].resolve(L(1, ['b'])));
  assert.deepEqual(box.s.placed.map((t) => t.key), ['b']);
  await m.unmount();
});

test('the catalogue notice names its own retry; the layout notice keeps its own', () => {
  const base = { profile: 'founder', viewer: { role: 'founder' } };
  const ready = studioFromReads({ ...base, layout: L(1, ['a']), modules: { failed: true, kind: 'read' } });
  const tree = StudioLayoutNotice({ studio: ready, titleOf: (k) => k });
  const flat = JSON.stringify(tree, (k, v) => (typeof v === 'function' ? 'fn' : v));
  assert.match(flat, /studio-notice-modules/);
  assert.doesNotMatch(flat, /studio-notice-read/, 'the layout read was fine');
  const layoutBad = StudioLayoutNotice({ studio: studioFromReads({ ...base, layout: { failed: true, kind: 'read' }, modules: CAT }), titleOf: (k) => k });
  const flat2 = JSON.stringify(layoutBad, (k, v) => (typeof v === 'function' ? 'fn' : v));
  assert.match(flat2, /studio-notice-read/);
  assert.doesNotMatch(flat2, /studio-notice-modules/);
});

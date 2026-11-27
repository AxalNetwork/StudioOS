// D4621 (#4621): one pending operation at a time, superseded responses dropped, leaving with edits asks first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm } from './_form_d695.mjs';
import { useStudioLayout } from '../src/pages/studio/useStudioLayout.js';
import { leavingLink } from '../src/pages/studio/useLeaveGuard.js';

const L = (rev, keys) => ({ source: 'saved', revision: rev, layout: keys.map((key) => ({ key, size: '1/2' })), dropped: [], updated_at: 'x' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fakeApi(read) {
  const saves = [];
  const resets = [];
  return {
    saves, resets,
    modules: async () => ({ modules: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], groups: [] }),
    layout: async () => read.value,
    saveLayout: (layout, revision, profile) => { const d = deferred(); saves.push({ layout, revision, profile, ...d }); return d.promise; },
    resetLayout: (profile) => { const d = deferred(); resets.push({ profile, ...d }); return d.promise; },
  };
}

async function mountHook(api, viewer = { role: 'founder' }, profile = 'founder') {
  const box = {};
  const Probe = ({ who, prof }) => { box.s = useStudioLayout({ profile: prof, viewer: who, api }); return null; };
  const m = await mountForm(h(Probe, { who: viewer, prof: profile }));
  await m.flush();
  return { m, box, rerender: (who, prof) => m.render(h(Probe, { who, prof })) };
}
const run = (fn) => act(async () => { await fn(); });

test('a draft is frozen while a save is in flight, and Saved describes what was sent', async () => {
  const api = fakeApi({ value: L(1, ['a']) });
  const { m, box } = await mountHook(api);
  await run(() => box.s.customise());
  await run(() => box.s.edit.add({ key: 'b' }));
  const sentKeys = box.s.shown.map((t) => t.key);
  let first;
  await act(async () => { first = box.s.done(); });
  assert.equal(box.s.saving, 'saving');
  await run(() => box.s.edit.add({ key: 'c' }));
  await run(() => box.s.edit.remove('a'));
  await run(() => box.s.done());
  await run(() => box.s.reset());
  assert.equal(api.saves.length, 1, 'a second Done sends nothing');
  assert.equal(api.resets.length, 0, 'Reset waits too');
  assert.deepEqual(box.s.shown.map((t) => t.key), sentKeys, 'the draft did not move');
  api.saves[0].resolve(L(2, sentKeys));
  await act(async () => { await first; });
  assert.equal(box.s.saving, 'saved');
  assert.deepEqual(box.s.placed.map((t) => t.key), sentKeys, 'Saved is the layout that went out');
  await m.unmount();
});

test('a save that answers after a reload or a profile change is dropped', async () => {
  const read = { value: L(1, ['a']) };
  const api = fakeApi(read);
  const { m, box, rerender } = await mountHook(api, { role: 'admin' }, 'founder');
  await run(() => box.s.customise());
  await run(() => box.s.edit.add({ key: 'b' }));
  let p;
  await act(async () => { p = box.s.done(); });
  assert.equal(api.saves[0].profile, 'founder');
  read.value = { ...L(1, ['c']), source: 'saved' };
  await rerender({ role: 'admin' }, 'investor');
  await m.flush();
  api.saves[0].resolve(L(2, ['a', 'b']));
  await act(async () => { await p; });
  assert.deepEqual(box.s.placed.map((t) => t.key), ['c'], "the founder's save does not draw into the investor's Studio");
  assert.notEqual(box.s.saving, 'saved');
  assert.equal(box.s.editing, false);
  await m.unmount();
});

test('a reset that fails after a reload does not set an error on the new read; a stale failure is silent', async () => {
  const api = fakeApi({ value: L(1, ['a']) });
  const { m, box } = await mountHook(api);
  await run(() => box.s.customise());
  let p;
  await act(async () => { p = box.s.reset(); });
  assert.equal(api.resets.length, 1);
  await run(() => box.s.reload());
  await m.flush();
  api.resets[0].reject(new Error('late'));
  await act(async () => { await p; });
  assert.equal(box.s.saveError, null);
  assert.equal(box.s.saving, 'idle');
  await m.unmount();
});

test('leaving: links ask, Stay keeps the draft, Discard re-sends the click, Save then goes', async () => {
  const api = fakeApi({ value: L(1, ['a']) });
  const wins = {}; const docs = {}; const pushed = []; const gone = [];
  const prev = { aw: globalThis.addEventListener, rw: globalThis.removeEventListener, history: globalThis.history, location: globalThis.location };
  const { m, box } = await mountHook(api);
  globalThis.addEventListener = (t, f) => { (wins[t] ||= []).push(f); };
  globalThis.removeEventListener = (t, f) => { wins[t] = (wins[t] || []).filter((x) => x !== f); };
  globalThis.history = { state: { idx: 1 }, pushState: (...a) => pushed.push(a), go: (n) => gone.push(n) };
  globalThis.location = { href: 'https://axal.vc/studio', origin: 'https://axal.vc', pathname: '/studio', search: '', hash: '' };
  m.doc.addEventListener = (t, f) => { (docs[t] ||= []).push(f); };
  m.doc.removeEventListener = (t, f) => { docs[t] = (docs[t] || []).filter((x) => x !== f); };
  try {
    assert.equal((wins.beforeunload || []).length, 0, 'nothing installed while clean');
    await run(() => box.s.customise());
    await run(() => box.s.edit.add({ key: 'b' }));
    assert.equal((wins.beforeunload || []).length, 1);
    assert.equal(pushed.length, 1, 'one entry pushed when edits begin');
    assert.equal((docs.click || []).length, 1);

    let clicks = 0;
    const anchor = { getAttribute: () => '/portfolio', hasAttribute: () => false, target: '', click() { clicks += 1; (docs.click || []).forEach((f) => f({ button: 0, target: { closest: () => anchor }, defaultPrevented: false, preventDefault() {}, stopPropagation() {} })); } };
    const ev = { button: 0, target: { closest: () => anchor }, defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    await run(() => docs.click[0](ev));
    assert.equal(ev.prevented, true);
    assert.equal(box.s.leave.asking, true);
    await run(() => box.s.leave.stay());
    assert.equal(box.s.leave.asking, false);
    assert.equal(box.s.editing, true, 'Stay keeps the draft');
    assert.equal(box.s.shown.length, 2);

    await run(() => docs.click[0](ev));
    await run(() => box.s.leave.proceed());
    assert.equal(clicks, 1, 'Discard re-sends the click once');
    assert.equal(ev.prevented, true);

    // Back: popstate asks; Stay puts the entry back; Save goes on after it.
    await run(() => wins.popstate[0]());
    assert.equal(box.s.leave.kind, 'back');
    const before = pushed.length;
    await run(() => box.s.leave.stay());
    assert.equal(pushed.length, before + 1);
    await run(() => wins.popstate[0]());
    let saved;
    await act(async () => { saved = box.s.leave.saveAndLeave(); });
    api.saves[0].resolve(L(2, ['a', 'b']));
    await act(async () => { await saved; });
    assert.deepEqual(gone, [-1], 'Back goes on once, after the save');
    assert.equal(box.s.saving, 'saved');
  } finally {
    Object.assign(globalThis, { addEventListener: prev.aw, removeEventListener: prev.rw, history: prev.history, location: prev.location });
  }
  await m.unmount();
});

test('which clicks are a departure', () => {
  const here = { href: 'https://axal.vc/studio?x=1', origin: 'https://axal.vc', pathname: '/studio', search: '?x=1' };
  const link = (href, extra = {}) => ({ getAttribute: () => href, hasAttribute: (k) => k === 'download' && !!extra.download, target: extra.target || '' });
  const click = (a, extra = {}) => ({ button: 0, defaultPrevented: false, target: { closest: () => a }, ...extra });
  assert.ok(leavingLink(click(link('/portfolio')), here));
  assert.equal(leavingLink(click(link('#top')), here), null, 'same page, a hash');
  assert.equal(leavingLink(click(link('/studio?x=1#a')), here), null);
  assert.equal(leavingLink(click(link('https://other.example/')), here), null, 'another site is the tab guard, not this one');
  assert.equal(leavingLink(click(link('/p', { target: '_blank' })), here), null);
  assert.equal(leavingLink(click(link('/p', { download: true })), here), null);
  assert.equal(leavingLink(click(link('/p'), { metaKey: true }), here), null);
  assert.equal(leavingLink(click(link('/p'), { button: 1 }), here), null);
  assert.equal(leavingLink(click(link('/p'), { defaultPrevented: true }), here), null);
  assert.equal(leavingLink({ button: 0, target: { closest: () => null } }, here), null);
});

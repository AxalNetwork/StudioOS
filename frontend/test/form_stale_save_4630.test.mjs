/**
 * D4630 (#4630): a Save's late answer cannot close or navigate anything but
 * the form that sent it.
 *
 * The real `FormLightbox` is mounted as the dialog with a deferred write. Each
 * test's `onClose` stands for CycleRoute's `closeAdd`, a Back in a history
 * stack, so "one navigation" is one pop.
 *
 * Test 1: while the write is pending, Cancel, the close icon, Escape and the
 * backdrop do nothing and the footer says the form stays open; the answer
 * then closes it once. Test 2: a refused write keeps the typed value, and the
 * form can then be closed. Test 3: the form unmounts (a route change) and a
 * newer form opens; the old write's success, and another's refusal, call
 * nothing and leave the newer form open. Each runs again on mutants of
 * `FormLightbox.jsx` that must fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

const path = 'pages/cycles/FormLightbox.jsx';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const form = { title: 'New signal', cta: 'Record signal', fields: [{ name: 'title', kind: 'T', k: 'Signal', required: true }] };

/** A history stack and a write whose answer the test releases. */
function harness() {
  const history = ['/validate', '/validate/demand-signals', '/validate/demand-signals/new'];
  const calls = { saved: 0, closed: 0 };
  const writes = [];
  const props = {
    form, cycle: 'validate', slug: 'demand-signals',
    onSaved: () => { calls.saved++; },
    onClose: () => { calls.closed++; history.pop(); },
    onSubmit: () => new Promise((resolve, reject) => { writes.push({ resolve, reject }); }),
  };
  return { history, calls, writes, props };
}

/** Sends the form without awaiting its answer (boxed: an async function would adopt it). */
async function startSave(mount) {
  const node = mount.nodes().find((n) => n.tagName === 'FORM');
  let pending;
  await act(async () => { pending = mount.props(node).onSubmit({ preventDefault() {} }); });
  return { pending };
}

async function tryEveryClose(mount) {
  // Called directly: a disabled button is not the only guard.
  await act(async () => mount.props(mount.by('cycle-form-cancel')).onClick?.());
  await act(async () => mount.props(mount.by('cycle-form-close')).onClick?.());
  await mount.escape();
  const backdrop = mount.by('cycle-form-backdrop');
  await act(async () => mount.props(backdrop).onMouseDown?.({ target: backdrop, currentTarget: backdrop }));
}

async function assertHeld(m) {
  const { history, calls, writes, props } = harness();
  const mount = await mountForm(h(m.default, props), { modal: true });
  try {
    await mount.input('title', 'Waitlist doubled');
    const { pending } = await startSave(mount);
    assert.equal(writes.length, 1);
    assert.equal(mount.props(mount.by('cycle-form-cancel')).disabled, true, 'Cancel is disabled while saving');
    assert.ok(mount.by('cycle-form-saving'), 'the footer says the form stays open');
    await tryEveryClose(mount);
    assert.equal(calls.closed, 0, 'no way out while the write is pending');
    assert.equal(history.length, 3);
    await act(async () => { writes[0].resolve({ ok: true }); await pending; });
    assert.equal(calls.saved, 1);
    assert.equal(calls.closed, 1, 'the answer closes the form once');
    assert.deepEqual(history, ['/validate', '/validate/demand-signals'], 'one Back, not two');
    assert.ok(!mount.by('cycle-form-saving'));
  } finally { await mount.unmount(); }
}

test('a pending save holds the form: Cancel, close, Escape and backdrop wait, then one close', async () => {
  await assertHeld({ default: FormLightbox });
  await mutationCheck(source, path, assertHeld, [
    ['const dismiss = () => { if (saving.current) return; onClose?.(); };', 'const dismiss = () => { onClose?.(); };'],
    ['onClose={dismiss} footer', 'onClose={onClose} footer'],
    ['onClick={dismiss} disabled={busy}', 'onClick={onClose}'],
    ['{busy ? <p role="status" data-testid="cycle-form-saving"', '{false ? <p role="status" data-testid="cycle-form-saving"'],
  ]);
});

async function assertRefusalKeepsEdits(m) {
  const { history, calls, writes, props } = harness();
  const mount = await mountForm(h(m.default, props), { modal: true });
  try {
    await mount.input('title', 'Waitlist doubled');
    const { pending } = await startSave(mount);
    await tryEveryClose(mount);
    await act(async () => { writes[0].reject(new Error('This could not be saved. Try again.')); await pending; });
    assert.equal(calls.saved, 0); assert.equal(calls.closed, 0);
    assert.ok(mount.by('cycle-form-refusal'));
    assert.equal(mount.props(mount.by('cycle-form-title')).value, 'Waitlist doubled', 'the typed value survives');
    assert.equal(mount.props(mount.by('cycle-form-cancel')).disabled, false);
    await mount.click('Cancel');
    assert.equal(calls.closed, 1);
    assert.equal(history.length, 2);
  } finally { await mount.unmount(); }
}

test('a refused save keeps the edits in the open form, which can then be closed', async () => {
  await assertRefusalKeepsEdits({ default: FormLightbox });
  await mutationCheck(source, path, assertRefusalKeepsEdits, [
    ['const dismiss = () => { if (saving.current) return; onClose?.(); };', 'const dismiss = () => { if (!saving.current) return; onClose?.(); };'],
  ]);
});

async function assertScopedToInstance(m) {
  const old = harness();
  const first = await mountForm(h(m.default, old.props), { modal: true });
  await first.input('title', 'Waitlist doubled');
  const { pending } = await startSave(first);
  // A route change: the form unmounts with its write still in flight.
  await first.unmount();
  const next = harness();
  const second = await mountForm(h(m.default, next.props), { modal: true });
  let open = true;
  try {
    await act(async () => { old.writes[0].resolve({ ok: true }); await pending; });
    assert.equal(old.calls.saved, 0, 'a late success calls nothing');
    assert.equal(old.calls.closed, 0, 'a late success navigates nowhere');
    assert.equal(old.history.length, 3);
    assert.equal(next.calls.closed, 0);
    assert.ok(second.by('cycle-form'), 'the newer form stays open');
    // A late refusal is just as inert.
    await second.input('title', 'Pre-sale');
    const { pending: failing } = await startSave(second);
    await second.unmount(); open = false;
    await act(async () => { next.writes[0].reject(new Error('No.')); await failing; });
    assert.equal(next.calls.saved, 0); assert.equal(next.calls.closed, 0);
  } finally { if (open) await second.unmount(); }
}

test('an answer after the form unmounts calls neither onSaved nor onClose', async () => {
  await assertScopedToInstance({ default: FormLightbox });
  await mutationCheck(source, path, assertScopedToInstance, [
    ['      if (!mounted.current) return;\n', ''],
    ['return () => { mounted.current = false; };', 'return undefined;'],
  ]);
});

// D1083 (#2948, Lovable part 3 of #2398) — From Lovable: the address Lovable
// gave the founder, its last live check and Check now (LV5, LV6, LV7's part).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lovable_app_links_d1083.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import FromLovable from '../src/pages/cycles/FromLovable.jsx';
import { LOVABLE_WORDS, checkedAt, slotView } from '../src/pages/cycles/lovableAppLink.js';

const h = React.createElement;

async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    /** Press without waiting: the pending state draws, and `done` settles it. */
    press(id) {
      const n = by(id); if (!n) throw new Error(`Missing ${id}`);
      let pending;
      act(() => { pending = pr(n).onClick?.({ preventDefault() {} }); });
      return { done: async () => { await act(async () => { await pending; }); await settle(); } };
    },
    async type(id, value) { const n = by(id); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const LIVE = { uid: 'u-1', app_url: 'https://harbor-ledger-waitlist.lovable.app/', host: 'harbor-ledger-waitlist.lovable.app', status: 'live', title: 'Harbor', checked_at: '2026-10-23T14:05:00Z', hosted_on: null };
const part = (...slots) => ({ state: 'ok', slots });
function fakeApi(answers = {}) {
  const calls = [];
  return {
    calls,
    api: {
      link: async (...a) => { calls.push(['link', ...a]); if (answers.link) return answers.link(...a); return { link: { ...LIVE, uid: 'u-new', app_url: a[3], status: 'not_checked', checked_at: null } }; },
      unlink: async (...a) => { calls.push(['unlink', ...a]); return { link: null }; },
      check: async (...a) => { calls.push(['check', ...a]); if (answers.check) return answers.check(...a); return { link: { ...LIVE, uid: a[2] } }; },
    },
  };
}

test('the words, the time and each state\'s view', () => {
  assert.equal(LOVABLE_WORDS.empty, 'No app linked yet. Paste the address Lovable gave you.');
  assert.equal(LOVABLE_WORDS.loading, 'Reading…');
  assert.equal(LOVABLE_WORDS.unreadable, 'Lovable’s figures could not be read. The address and its last check are kept.');
  assert.equal(LOVABLE_WORDS.inviteOnly, 'The app may be Invite only in Lovable.');
  assert.equal(checkedAt('2026-10-23T14:05:59Z'), '2026-10-23 14:05');
  assert.equal(checkedAt(null), null);
  assert.equal(checkedAt('nonsense'), null);
  assert.deepEqual(slotView({ link: null }), { kind: 'empty' });
  assert.equal(slotView({ link: LIVE }).line, 'checked 2026-10-23 14:05');
  const down = slotView({ link: { ...LIVE, status: 'not_reachable' } });
  assert.equal(down.line, 'Not reachable, checked 2026-10-23 14:05.', 'Not reachable always carries its time');
  assert.equal(down.note, 'The app may be Invite only in Lovable.');
  assert.equal(slotView({ link: { ...LIVE, status: 'not_reachable', checked_at: null } }).status, 'not_checked', 'Not reachable with no time is not claimed');
  assert.equal(slotView({ link: { ...LIVE, status: 'not_checked', checked_at: null } }).pill, 'Not checked', 'never an empty line');
  assert.equal(slotView({ link: { ...LIVE, status: 'live', checked_at: null } }).status, 'not_checked', 'Live with no time is not claimed');
  assert.equal(slotView({ link: { ...LIVE, hosted_on: 'vercel' } }).pill, 'Hosted on Vercel');
});

test('empty: the address is linked only after asking, in place; nothing is fetched by linking', async () => {
  // Mutation checked: the link sent without asking; Check now fired on link.
  const f = fakeApi();
  const m = await mount(h(FromLovable, { part: part({ record_id: 1, label: 'Prototype / MVP', link: null }), cycle: 'build', projectId: 7, api: f.api }));
  try {
    assert.match(m.text(m.by('cycle-part-lovable')), /^From Lovable Connector · Lovable/);
    assert.equal(m.text(m.by('lovable-1-empty')).startsWith(LOVABLE_WORDS.empty), true);
    assert.equal(m.by('lovable-1-input') && Object.entries(m.by('lovable-1-input')).find(([k]) => k.startsWith('__reactProps$'))[1].placeholder, 'https://….lovable.app');
    await m.type('lovable-1-input', 'https://harbor.lovable.app');
    await m.click('lovable-1-link');
    assert.match(m.text(m.by('lovable-1-confirm')), /Link this app\? From Lovable shows this address on Prototype \/ MVP\. Nothing is read until you press Check now\./);
    assert.equal(f.calls.length, 0, 'nothing is saved before the confirmation');
    await m.click('lovable-1-confirm-button');
    assert.deepEqual(f.calls, [['link', 'build', 7, null, 'https://harbor.lovable.app']], 'Prototype / MVP sends no record id');
    assert.ok(!m.by('lovable-1-confirm'));
    assert.equal(m.text(m.by('lovable-1-pill')), 'Not checked');
    assert.equal(m.text(m.by('lovable-1-address')), 'https://harbor.lovable.app');
  } finally { await m.unmount(); }
});

test('Check now: one call per press, Reading… while it runs, then Live with its time; Not reachable is amber with the Invite-only line', async () => {
  // Mutation checked: Check now calling twice; Not reachable without its time.
  let release;
  const f = fakeApi({ check: () => new Promise((r) => { release = () => r({ link: { ...LIVE, status: 'not_reachable', checked_at: '2026-10-24T09:00:00Z' } }); }) });
  const m = await mount(h(FromLovable, { part: part({ record_id: 5, label: 'Landing page test', link: LIVE }, { record_id: 6, label: 'Pricing page', link: null }), cycle: 'validate', projectId: 7, api: f.api }));
  try {
    assert.equal(m.text(m.by('lovable-5-address')), 'https://harbor-ledger-waitlist.lovable.app/');
    assert.equal(m.text(m.by('lovable-5-pill')), 'Live');
    assert.equal(m.text(m.by('lovable-5-line')), 'checked 2026-10-23 14:05');
    assert.match(m.text(m.by('lovable-5')), /^LANDING PAGE TEST|^Landing page test/i, 'each experiment is labelled');
    assert.ok(m.by('lovable-6-empty'), 'an experiment with no link reads empty');
    const pressing = m.press('lovable-5-check');
    assert.equal(m.text(m.by('lovable-5-loading')), 'Reading…');
    assert.ok(!m.by('lovable-5-check'), 'no second press while it reads');
    release(); await pressing.done();
    assert.deepEqual(f.calls, [['check', 'validate', 7, 'u-1']]);
    assert.equal(m.text(m.by('lovable-5-pill')), 'Not reachable');
    assert.equal(m.text(m.by('lovable-5-line')), 'Not reachable, checked 2026-10-24 09:00.');
    assert.equal(m.text(m.by('lovable-5-note')), 'The app may be Invite only in Lovable.');
    assert.ok(m.by('lovable-5-check'), 'Check now stays');
  } finally { await m.unmount(); }
});

test('Unreadable says so with Try again, never an empty list; a refusal stays in place; Hosted on Vercel draws no Live line', async () => {
  // Mutation checked: unreadable drawn as empty; the refusal dropped.
  let retried = 0;
  const u = await mount(h(FromLovable, { part: { state: 'unreadable' }, cycle: 'build', projectId: 7, onRetry: () => { retried += 1; } }));
  try {
    assert.equal(u.text(u.by('lovable-unreadable')), `${LOVABLE_WORDS.unreadable} Try again`);
    assert.ok(!u.by('lovable-1-empty'));
    await u.click('lovable-retry');
    assert.equal(retried, 1);
  } finally { await u.unmount(); }

  const f = fakeApi({ link: () => { throw Object.assign(new Error('Use the https:// address Lovable gave you.'), { status: 400 }); } });
  const r = await mount(h(FromLovable, { part: part({ record_id: 1, label: 'Prototype / MVP', link: null }), cycle: 'build', projectId: 7, api: f.api }));
  try {
    await r.type('lovable-1-input', 'http://harbor.lovable.app');
    await r.click('lovable-1-link');
    await r.click('lovable-1-confirm-button');
    assert.equal(r.text(r.by('lovable-1-error')), 'Use the https:// address Lovable gave you.');
    assert.ok(r.by('lovable-1-confirm'), 'the question stays open');
  } finally { await r.unmount(); }

  const v = await mount(h(FromLovable, { part: part({ record_id: 1, label: 'Prototype / MVP', link: { ...LIVE, hosted_on: 'vercel' } }), cycle: 'build', projectId: 7, api: fakeApi().api }));
  try {
    assert.equal(v.text(v.by('lovable-1-pill')), 'Hosted on Vercel');
    assert.ok(!v.by('lovable-1-check'), 'the Live line is Vercel\'s: no second Check now');
    assert.ok(!v.by('lovable-1-line'));
  } finally { await v.unmount(); }
});

test('remove asks first and says nothing changes in Lovable; the experiment record mounts the part', async () => {
  const f = fakeApi();
  const m = await mount(h(FromLovable, { part: part({ record_id: 5, label: 'Landing page test', link: LIVE }), cycle: 'validate', projectId: 7, api: f.api }));
  try {
    await m.click('lovable-5-remove');
    assert.match(m.text(m.by('lovable-5-confirm')), /Remove the app’s address\? From Lovable forgets this address and its last check on Landing page test\. Nothing changes in Lovable\./);
    assert.equal(f.calls.length, 0);
    await m.click('lovable-5-confirm-button');
    assert.deepEqual(f.calls, [['unlink', 'validate', 7, 5]]);
    assert.ok(m.by('lovable-5-empty'));
  } finally { await m.unmount(); }
  const parts = readFileSync(new URL('../src/pages/cycles/buildParts.jsx', import.meta.url), 'utf8');
  assert.match(parts, /\['lovable', \(data, ctx\) => <FromLovable part=\{data\?\.parts\?\.lovable\} cycle="build" projectId=\{ctx\.projectId\} onRetry=\{ctx\.reload\} \/>\]/,
    'Prototype / MVP draws From Lovable from its read, as Build');
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /experiments: \(read, ctx\) => <div className="space-y-3">[\s\S]*?<FromLovable part=\{read\.parts\.lovable\} cycle="validate" projectId=\{ctx\.projectId\} onRetry=\{ctx\.reload\} \/>/);
});

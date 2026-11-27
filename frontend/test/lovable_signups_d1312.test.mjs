// D1312 (#3432, Lovable part 4 of #2398) — LV5's "With a sign-up address"
// inside From Lovable: the count for every reader, the address with Copy and
// Turn off… for the venture's writers, and Make a sign-up address. Each change
// asks first, in place. Every address and figure is made up.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lovable_signups_d1312.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import FromLovable from '../src/pages/cycles/FromLovable.jsx';
import { LOVABLE_WORDS, signupView } from '../src/pages/cycles/lovableAppLink.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ADDRESS = 'https://axal.vc/api/validate/lovable-signups/0123456789abcdef0123456789abcdef';

async function mount(el) {
  const restore = installDocument();
  const prev = { alert: globalThis.alert, confirm: globalThis.confirm, nav: globalThis.navigator };
  const popups = [];
  const copies = [];
  globalThis.alert = (...a) => popups.push(a); globalThis.confirm = (...a) => { popups.push(a); return true; };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test', clipboard: { writeText: async (t) => { copies.push(t); } } }, configurable: true, writable: true });
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
    popups, copies, has: (id) => Boolean(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); Object.assign(globalThis, { alert: prev.alert, confirm: prev.confirm }); Object.defineProperty(globalThis, 'navigator', { value: prev.nav, configurable: true, writable: true }); restore(); },
  };
}

const slot = (signup, extra = {}) => ({ record_id: 5, label: 'Landing page test', link: null, signup, ...extra });
const part = (writer, ...slots) => ({ state: 'ok', signup_writer: writer, slots });
function fakeApi() {
  const calls = [];
  return {
    calls,
    api: {
      link: async () => ({ link: null }), unlink: async () => ({ link: null }), check: async () => ({ link: null }),
      makeSignup: async (...a) => { calls.push(['make', ...a]); return { signup: { live: true, uid: 'u1', address: ADDRESS, count: 0, since: '2026-10-27' } }; },
      turnOffSignup: async (...a) => { calls.push(['off', ...a]); return { signup: null }; },
    },
  };
}

test('the view: none on Build, unreadable, empty, or live with the count; the address only for a writer; never a made-up count', () => {
  assert.equal(signupView({ record_id: 1, link: null }, true).kind, 'none', 'Build gives no field');
  assert.equal(signupView(slot(null, { signup_unreadable: true }), true).kind, 'unreadable');
  assert.deepEqual(signupView(slot(null), true), { kind: 'empty', canMake: true });
  assert.deepEqual(signupView(slot(null), false), { kind: 'empty', canMake: false });
  assert.deepEqual(signupView(slot({ live: true, address: ADDRESS, count: 12 }), true), { kind: 'live', canChange: true, address: ADDRESS, count: '12 sign-ups received' });
  assert.equal(signupView(slot({ live: true, address: null, count: 1 }), false).count, '1 sign-up received');
  assert.equal(signupView(slot({ live: true, address: null, count: 1 }), false).address, null);
  assert.match(signupView(slot({ live: true, address: ADDRESS, count: null }), true).count, /^Not recorded/);
  assert.equal(LOVABLE_WORDS.signupNote, 'Point the app’s form at this address. Only the count is kept, never the names or emails.');
});

test('a writer makes an address: it asks first, says what it changes, then shows the address with Copy', async () => {
  const { calls, api } = fakeApi();
  const m = await mount(h(FromLovable, { part: part(true, slot(null)), cycle: 'validate', projectId: 1, api }));
  try {
    assert.match(m.text('lovable-5-signup-none'), /No sign-up address yet/);
    await m.click('lovable-5-signup-make');
    assert.match(m.text('lovable-5-signup-says'), /Landing page test gets its own address.*Only the count is kept, never the names or emails\./);
    assert.deepEqual(calls, [], 'nothing is made before the confirm');
    await m.click('lovable-5-signup-confirm-button');
    assert.deepEqual(calls, [['make', 1, 5]]);
    assert.equal(m.text('lovable-5-signup-address'), ADDRESS);
    assert.equal(m.text('lovable-5-signup-count'), '0 sign-ups received');
    await m.click('lovable-5-signup-copy');
    assert.deepEqual(m.copies, [ADDRESS]);
    assert.equal(m.text('lovable-5-signup-copy'), 'Copied');
    assert.deepEqual(m.popups, []);
  } finally { await m.unmount(); }
});

test('a writer turns it off: it says sign-ups already counted stay counted; afterwards no address shows', async () => {
  const { calls, api } = fakeApi();
  const m = await mount(h(FromLovable, { part: part(true, slot({ live: true, uid: 'u1', address: ADDRESS, count: 12 })), cycle: 'validate', projectId: 1, api }));
  try {
    assert.equal(m.text('lovable-5-signup-count'), '12 sign-ups received');
    await m.click('lovable-5-signup-off');
    assert.match(m.text('lovable-5-signup-says'), /refused from now on\. The sign-ups already counted stay counted\./);
    await m.click('lovable-5-signup-cancel');
    assert.deepEqual(calls, []);
    await m.click('lovable-5-signup-off');
    await m.click('lovable-5-signup-confirm-button');
    assert.deepEqual(calls, [['off', 1, 5]]);
    assert.equal(m.has('lovable-5-signup-address'), false);
    assert.ok(m.has('lovable-5-signup-none'));
  } finally { await m.unmount(); }
});

test('a reader sees the count only: no address, no Copy, no Make, no Turn off; an unreadable block says so; Build draws none', async () => {
  const { api } = fakeApi();
  const r = await mount(h(FromLovable, { part: part(false, slot({ live: true, uid: 'u1', address: null, count: 3 })), cycle: 'validate', projectId: 1, api }));
  try {
    assert.equal(r.text('lovable-5-signup-count'), '3 sign-ups received');
    for (const id of ['lovable-5-signup-address', 'lovable-5-signup-copy', 'lovable-5-signup-off']) assert.equal(r.has(id), false, id);
  } finally { await r.unmount(); }
  const e = await mount(h(FromLovable, { part: part(false, slot(null)), cycle: 'validate', projectId: 1, api }));
  try { assert.equal(e.has('lovable-5-signup-make'), false); } finally { await e.unmount(); }
  const u = await mount(h(FromLovable, { part: part(true, slot(null, { signup_unreadable: true })), cycle: 'validate', projectId: 1, api }));
  try { assert.match(u.text('lovable-5-signup-unreadable'), /not the same as none/); } finally { await u.unmount(); }
  const b = await mount(h(FromLovable, { part: { state: 'ok', slots: [{ record_id: 1, label: 'Prototype / MVP', link: null }] }, cycle: 'build', projectId: 1, api }));
  try { assert.equal(b.has('lovable-1-signup'), false); } finally { await b.unmount(); }
});

test('the wiring: the client names the Worker routes; no pop-up, no hex', () => {
  const client = read('frontend/src/lib/api/lovableAppLinks.js');
  assert.match(client, /signupBase = \(cycle = 'validate'\) => `\/cycles\/\$\{encodeURIComponent\(cycle\)\}\/lovable\/signup-token`/);
  assert.match(client, /makeSignup: \(project, recordId\) => request\(`\$\{signupBase\(\)\}\?project=/);
  assert.match(client, /turnOffSignup:.*method: 'DELETE'/s);
  const routes = read('cloudflare-worker/src/routes/lovable_app_links.ts');
  assert.ok(routes.includes("app.post('/:cycle/lovable/signup-token'") && routes.includes("app.delete('/:cycle/lovable/signup-token'"));
  const src = read('frontend/src/pages/cycles/FromLovable.jsx');
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(src, /(bg|text|border)-\[#/);
  assert.match(read('documentation/architecture/decisions/D1312.md'), /## D1312/);
});

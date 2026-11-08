/**
 * D5040 (#5040) — the holder console on HQ · Team.
 *
 *   1. A transfer the server REFUSED (or that failed) keeps the operator's reason and the
 *      chosen successor. They were cleared after every submit, success or not.
 *   2. A CONFIRMED transfer takes HQ's screens away from this browser without a reload:
 *      the page above is told (`onTransferred`), `leaveHq` clears the elevation on the
 *      signed-in user (which is what `hqOnly` reads), re-reads /me, and leaves one line for
 *      the closed-page notice to show once.
 *
 * Mounted over a stubbed `api`; no network. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/super_admin_handover_5040.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { mountForm } from './_form_d695.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import SuperAdminHolders from '../src/pages/hq/SuperAdminHolders.jsx';
import SuperAdminOnlyNotice from '../src/pages/hq/SuperAdminOnlyNotice.jsx';
import { clearHandover, leaveHq, peekHandover, rememberHandover } from '../src/pages/hq/handoverNote.js';

const h = React.createElement;
const REASON = 'Guillaume steps back from operations; Sam runs HQ';

// sessionStorage for the handover note (Node has none).
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

function stubApi(grant) {
  api.superAdmins = async () => ({ holders: [{ id: 1, name: 'Holder Hart', email: 'holder@axal.example', is_active: 1 }] });
  api.hqAdmins = async () => ({ items: [{ user_id: 2, name: 'Sam Successor', email: 'sam@axal.example', is_active: 1 }] });
  api.superAdminGrant = grant;
}

const selectOf = (page) => page.nodes().find((n) => n.tagName === 'SELECT');
async function fill(page) {
  await act(async () => page.props(selectOf(page)).onChange({ target: { value: '2' } }));
  await act(async () => page.props(page.by('super-admin-reason')).onChange({ target: { value: REASON } }));
}
const valueOf = (page, node) => page.props(node).value;

async function mountConsole(extra = {}) {
  const page = await mountForm(h(SuperAdminHolders, extra));
  await page.flush();
  return page;
}

test('a refused transfer keeps the typed reason and the chosen successor, and says why', async () => {
  const calls = [];
  stubApi(async (...a) => { calls.push(a); throw new Error('The administrator you named stopped being an active administrator while this request was in flight, so nothing was moved. You still hold the elevation.'); });
  let told = 0;
  const page = await mountConsole({ onTransferred: async () => { told += 1; } });
  await fill(page);
  await page.submit();
  await page.flush();
  assert.equal(calls.length, 1, 'the transfer was never attempted');
  assert.deepEqual(calls[0], [2, { transfer: true, reason: REASON }]);
  assert.equal(valueOf(page, selectOf(page)), '2', 'the chosen successor was cleared after a refusal');
  assert.equal(valueOf(page, page.by('super-admin-reason')), REASON, 'the typed reason was cleared after a refusal');
  assert.match(page.text(), /nothing was moved/);
  assert.equal(told, 0, 'HQ was closed for a transfer that moved nothing');
  assert.ok(!page.by('super-admin-handed'), 'the handed-over card is drawn for a refusal');
  await page.unmount();
});

test('a network failure keeps them too', async () => {
  stubApi(async () => { throw new Error('Failed to fetch'); });
  const page = await mountConsole({ onTransferred: async () => {} });
  await fill(page);
  await page.submit();
  await page.flush();
  assert.equal(valueOf(page, page.by('super-admin-reason')), REASON);
  assert.equal(valueOf(page, selectOf(page)), '2');
  await page.unmount();
});

test('a confirmed transfer tells the page once, with the successor\'s name, and draws the handed-over card', async () => {
  const told = [];
  stubApi(async () => ({ ok: true }));
  const page = await mountConsole({ onTransferred: async (name) => { told.push(name); } });
  await fill(page);
  await page.submit();
  await page.flush();
  assert.deepEqual(told, ['Sam Successor']);
  assert.match(page.text(), /Handed to Sam Successor/);
  await page.unmount();
});

test('a plain grant (nobody holds it) does not leave HQ', async () => {
  let told = 0;
  api.superAdmins = async () => ({ holders: [] });
  api.hqAdmins = async () => ({ items: [{ user_id: 2, name: 'Sam Successor', email: 'sam@axal.example', is_active: 1 }] });
  api.superAdminGrant = async () => ({ ok: true });
  const page = await mountConsole({ onTransferred: async () => { told += 1; } });
  await fill(page);
  await page.submit();
  await page.flush();
  assert.equal(told, 0);
  await page.unmount();
});

// ── leaving HQ ──────────────────────────────────────────────────────────────

test('leaveHq clears the elevation on the signed-in user, re-reads /me and leaves the one line', async () => {
  clearHandover();
  const set = [];
  const refreshed = [];
  await leaveHq({
    name: 'Sam Successor', user: { id: 1, role: 'admin', is_super_admin: 1, name: 'Holder Hart' },
    setUser: (u) => set.push(u), refresh: async (o) => { refreshed.push(o); },
  });
  assert.deepEqual(set, [{ id: 1, role: 'admin', is_super_admin: 0, name: 'Holder Hart' }]);
  assert.deepEqual(refreshed, [{ force: true }]);
  assert.equal(peekHandover()?.name, 'Sam Successor');
  clearHandover();
});

test('leaveHq still leaves HQ when /me cannot be re-read, and reports it', async () => {
  const set = [];
  const errors = [];
  await leaveHq({
    name: 'Sam', user: { id: 1, is_super_admin: 1 }, setUser: (u) => set.push(u),
    refresh: async () => { throw new Error('offline'); }, onRefreshError: (e) => errors.push(e.message),
  });
  assert.equal(set[0].is_super_admin, 0);
  assert.deepEqual(errors, ['offline']);
  clearHandover();
});

test('leaveHq with no signed-in user in context changes nothing it should not', async () => {
  const set = [];
  await leaveHq({ name: 'Sam', user: null, setUser: (u) => set.push(u), refresh: async () => {} });
  assert.deepEqual(set, []);
  clearHandover();
});

test('the closed-page notice shows the handover once, in a status region, and clears it', async () => {
  clearHandover();
  rememberHandover('Sam Successor');
  const page = await mountForm(h(SuperAdminOnlyNotice));
  await page.flush();
  const note = page.by('super-admin-handed-note');
  assert.ok(note, 'the former holder is not told what happened');
  assert.equal(page.props(note).role, 'status');
  assert.match(page.text(), /You handed the Super Admin elevation to Sam Successor/);
  assert.equal(peekHandover(), null, 'the note would show again on the next visit');
  await page.unmount();
  const again = await mountForm(h(SuperAdminOnlyNotice));
  assert.ok(!again.by('super-admin-handed-note'), 'an admin who never held it is told they handed it on');
  await again.unmount();
});

// ── wiring ──────────────────────────────────────────────────────────────────

test('the Team page closes HQ through leaveHq with the signed-in user, setUser and refresh', () => {
  const page = codeOnly(readFileSync(fileURLToPath(new URL('../src/pages/hq/AccountsPage.jsx', import.meta.url)), 'utf8'));
  assert.match(page, /const \{ user, setUser, refresh \} = useAuth\(\);/);
  assert.match(page, /onTransferred=\{\(name\) => leaveHq\(\{ name, user, setUser, refresh,/);
});

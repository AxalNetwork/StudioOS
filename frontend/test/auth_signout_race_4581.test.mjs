/**
 * #4581 (Grow audit) — "Signing you out of your previous session…" that never
 * ends. Reproduced here against the real AuthProvider (`hooks/useAuthSync.jsx`):
 *
 *   1. a signed-in visitor arrives on a page (here /grow), and the route
 *      change starts `refresh()`: `GET /api/auth/me` goes out with the session
 *      cookie still valid;
 *   2. before it answers, /login's AuthScreen signs them out: `setUser(null)`,
 *      the cached user removed, the server logout sent in the background;
 *   3. the older `/me` then answers with the old account, and `refresh()`
 *      wrote it back — into state AND localStorage — so AuthScreen, whose
 *      teardown runs once, saw a user again and drew the sign-out message for
 *      good. A reload cleared it, because the logout had landed by then.
 *
 * The fix (D4581): a sign-out (`setUser(null)`) moves the session on, and a
 * `/me` that started before it is dropped when it answers.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/auth_signout_race_4581.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { AuthProvider, useAuth } from '../src/hooks/useAuthSync.jsx';

const h = React.createElement;
const USER = { id: 7, email: 'founder@example.com', name: 'Fran Founder', role: 'founder' };
const deferred = () => { let res; let rej; const promise = new Promise((a, b) => { res = a; rej = b; }); return { promise, res, rej }; };

async function mount(path = '/grow') {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(USER));
  const saved = api.getMe;
  const pending = [];
  api.getMe = () => { const d = deferred(); pending.push(d); return d.promise; };
  const probe = {};
  function Probe() { Object.assign(probe, useAuth(), { navigate: useNavigate() }); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, h(Probe)))); });
  return {
    probe, pending,
    async done() { await act(async () => root.unmount()); api.getMe = saved; restore(); },
  };
}

test('a /me that started before a sign-out does not sign the old account back in', async () => {
  const m = await mount('/grow');
  try {
    assert.equal(m.pending.length, 1, 'arriving on a page with a cached user re-reads /me');
    // /login's teardown, as clearSession does it: the user and the cache go at once.
    await act(async () => { localStorage.removeItem('user'); m.probe.setUser(null); });
    assert.equal(m.probe.user, null);
    // The older /me answers with the session that was still valid when it was sent.
    await act(async () => { m.pending[0].res({ ...USER }); await Promise.resolve(); });
    assert.equal(m.probe.user, null, 'the old account came back after sign-out: /login would hang on "Signing you out…"');
    assert.equal(localStorage.getItem('user'), null, 'the old account was written back to the cache');
  } finally { await m.done(); }
  // Mutation checked: removing the session check from refresh() → the user and the cache come back.
});

test('a /me that started after the sign-out, for a new sign-in, still lands', async () => {
  const m = await mount('/grow');
  try {
    await act(async () => { localStorage.removeItem('user'); m.probe.setUser(null); });
    await act(async () => { m.pending[0].res({ ...USER }); await Promise.resolve(); });
    // A new account signs in, and its own /me is read.
    const next = { id: 9, email: 'new@example.com', name: 'New Person', role: 'investor' };
    await act(async () => { m.probe.setUser(next); });
    let fresh;
    await act(async () => { fresh = m.probe.refresh({ force: true }); });
    assert.equal(m.pending.length, 2);
    await act(async () => { m.pending[1].res({ ...next, name: 'New Person (read)' }); await fresh; });
    assert.equal(m.probe.user?.name, 'New Person (read)', 'a read started after the sign-in was dropped');
  } finally { await m.done(); }
});

test('without a sign-out, /me still refreshes the cached user as before', async () => {
  const m = await mount('/grow');
  try {
    await act(async () => { m.pending[0].res({ ...USER, name: 'Fran F. (updated)' }); await Promise.resolve(); });
    assert.equal(m.probe.user?.name, 'Fran F. (updated)');
    assert.equal(JSON.parse(localStorage.getItem('user')).name, 'Fran F. (updated)');
  } finally { await m.done(); }
});

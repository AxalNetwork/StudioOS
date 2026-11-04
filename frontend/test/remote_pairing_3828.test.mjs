// D1581 (#3828, canvas PR1 to PR6): pairing a phone to Present.
//   * the words and the pure rules: the grouped code, digits, the countdown,
//     one answer for a wrong or expired code, a step not delivered;
//   * PR1: Present's Phone remote makes a code, shows it with its QR and its
//     countdown, and a paired phone turns it into "Phone remote · on" + Unpair;
//   * PR2 to PR4: /remote joins with the six digits, sends the card it lands on,
//     says when Present isn't open, and goes back to the code when disconnected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api, isPublicPath } from '../src/lib/api.js';
import { deckRemoteApi } from '../src/lib/api/deckRemote.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import RemotePair from '../src/pages/raise/pitch/RemotePair.jsx';
import RemotePage from '../src/pages/raise/pitch/RemotePage.jsx';
import {
  DIDNT_WORK, DISCONNECTED, NOT_PRESENTING, REMOTE_OFF, SIGNED_OUT, TOO_MANY,
  boxesOf, cardAfter, digitsOf, expiresLine, groupCode, joinRefusal, pairRefusal, remoteLink, secondsLeft, signInHref, spokenCode, spokenMinute, stepOutcome,
} from '../src/pages/raise/pitch/remoteModel.js';

const h = React.createElement;
const err = (status, code) => Object.assign(new Error(code || 'synthetic'), { status, code });

test('the pure rules: grouped code, digits, countdown, one answer for a bad code, a step not delivered', () => {
  assert.equal(groupCode('482913'), '482 913');
  assert.equal(spokenCode('482913'), '4 8 2 9 1 3', 'read digit by digit');
  assert.equal(digitsOf(' 48-29 13x9'), '482913');
  assert.deepEqual(boxesOf('48'), ['4', '8', '', '', '', '']);
  const now = Date.parse('2026-11-04T10:00:00Z');
  assert.equal(secondsLeft('2026-11-04 10:09:42', now), 582);
  assert.equal(expiresLine(582), 'Expires in 9:42');
  assert.equal(secondsLeft('2026-11-04T09:00:00Z', now), 0, 'never below 0');
  assert.equal(spokenMinute(540), '9 minutes left');
  assert.equal(spokenMinute(541), null, 'the countdown is announced at most once a minute');
  assert.equal(remoteLink('https://app.axal.vc/', '482 913'), 'https://app.axal.vc/remote?code=482913');
  assert.equal(signInHref('482913'), `/login?next=${encodeURIComponent('/remote?code=482913')}`);
  assert.equal(pairRefusal(err(503, 'remote_off')), 'off');
  assert.equal(pairRefusal(err(500)), 'error');
  // Wrong, expired and no access are one answer.
  for (const e of [err(404, 'code_not_found'), err(403, 'forbidden'), err(410)]) assert.equal(joinRefusal(e), 'didnt_work');
  assert.equal(joinRefusal(err(429)), 'too_many');
  assert.equal(joinRefusal(err(401)), 'signed_out');
  assert.equal(stepOutcome({ ok: true, delivered: false }), 'not_presenting');
  assert.equal(stepOutcome({ ok: true, delivered: true }), 'ok');
  assert.equal(stepOutcome(null, err(409, 'remote_not_paired')), 'disconnected');
  assert.equal(stepOutcome(null, err(500)), 'failed');
  assert.deepEqual([cardAfter(0, 'prev', 5), cardAfter(4, 'next', 5), cardAfter(2, 'next', 5), cardAfter(2, 'last', 5)], [0, 4, 3, 4]);
  assert.equal(isPublicPath('/remote'), true, 'a signed-out phone sees PR2d, not a bounce');
});

const ORIGINAL = { api: { ...api }, remote: { ...deckRemoteApi } };
async function mount(el, url = '/', { user = null } = {}) {
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, el))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    by, pr, text, settle,
    async press(node) { assert.ok(node, 'drawn'); await act(async () => { await pr(node).onClick?.({ preventDefault() {} }); }); await settle(); },
    async submit(node) { await act(async () => { await pr(node).onSubmit?.({ preventDefault() {} }); }); await settle(); },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async rerender(next) { await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, next))); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); Object.assign(api, ORIGINAL.api); Object.assign(deckRemoteApi, ORIGINAL.remote); },
  };
}

test('PR1: Phone remote makes a code and shows it grouped, with its QR and countdown; paired turns it into a chip with Unpair', async () => {
  const calls = [];
  const soon = new Date(Date.now() + 9 * 60_000 + 42_000).toISOString();
  Object.assign(deckRemoteApi, {
    pair: async (id) => { calls.push(['pair', id]); return { deck_id: id, code: '482913', expires_at: soon }; },
    unpair: async (id) => { calls.push(['unpair', id]); return { ok: true }; },
  });
  let unpaired = 0;
  const m = await mount(h(RemotePair, { deckId: 31, paired: false, onUnpaired: () => { unpaired += 1; } }));
  try {
    assert.ok(!m.by('remote-pair-panel'));
    await m.press(m.by('remote-pair-open'));
    assert.deepEqual(calls, [['pair', 31]]);
    assert.equal(m.text(m.by('remote-pair-code')), '482 913');
    assert.equal(m.pr(m.by('remote-pair-code'))['aria-label'], 'Code 4 8 2 9 1 3');
    assert.match(m.text(m.by('remote-pair-expires')), /^Expires in 9:4\d$/);
    assert.ok(m.by('remote-pair-qr'), 'a QR code for /remote?code=…');
    await m.rerender(h(RemotePair, { deckId: 31, paired: true, onUnpaired: () => { unpaired += 1; } }));
    assert.ok(!m.by('remote-pair-panel'), 'the panel closes by itself once paired');
    assert.match(m.text(m.by('remote-pair-on')), /Phone remote · on/);
    await m.press(m.by('remote-pair-menu'));
    await m.press(m.by('remote-pair-unpair'));
    assert.deepEqual(calls.at(-1), ['unpair', 31]);
    assert.equal(unpaired, 1);
  } finally { await m.close(); }
});

test('PR1d and PR1e: a Worker without the remote says it is off; a failed press says so with Try again', async () => {
  Object.assign(deckRemoteApi, { pair: async () => { throw err(503, 'remote_off'); } });
  const m = await mount(h(RemotePair, { deckId: 31 }));
  try {
    await m.press(m.by('remote-pair-open'));
    assert.equal(m.text(m.by('remote-pair-off')), REMOTE_OFF);
    assert.ok(!m.by('remote-pair-new'), 'no code to renew while it is off');
  } finally { await m.close(); }
  Object.assign(deckRemoteApi, { pair: async () => { throw err(500); } });
  const m2 = await mount(h(RemotePair, { deckId: 31 }));
  try {
    await m2.press(m2.by('remote-pair-open'));
    assert.match(m2.text(m2.by('remote-pair-error')), /couldn.t be made/);
    assert.equal(m2.text(m2.by('remote-pair-new')), 'Try again');
  } finally { await m2.close(); }
});

const DECK = { id: 31, title: 'Synthetic deck', slides: [{ title: 'Problem', notes: 'Open with the pain.' }, { title: 'Solution', notes: 'Then the fix.' }, { title: 'Ask', notes: '' }] };
const USER = { id: 2, role: 'founder', name: 'Synthetic Founder' };

test('PR2 to PR3: the code joins, the remote shows the card, and each press sends the card it lands on', async () => {
  const calls = [];
  Object.assign(deckRemoteApi, {
    join: async (code) => { calls.push(['join', code]); return { deck_id: 31, remote_id: 'r1', expires_at: null }; },
    step: async (id, rid, step) => { calls.push(['step', id, rid, step]); return { ok: true, delivered: calls.filter(([n]) => n === 'step').length < 2 }; },
  });
  api.deckGet = async () => DECK;
  const m = await mount(h(RemotePage), '/remote', { user: USER });
  try {
    assert.equal(m.pr(m.by('remote-connect')).disabled, true, 'six digits first');
    await m.type(m.by('remote-box-0'), '482913');
    assert.deepEqual(['0', '1', '2', '3', '4', '5'].map((k) => m.pr(m.by(`remote-box-${k}`)).value), ['4', '8', '2', '9', '1', '3'], 'paste fills all six');
    await m.submit(m.by('remote-boxes').parentNode);
    assert.deepEqual(calls[0], ['join', '482913']);
    assert.match(m.text(m.by('remote-connected')), /Connected to Synthetic deck/);
    assert.match(m.text(m.by('remote-card')), /Problem/);
    await m.press(m.by('remote-next-card'));
    assert.deepEqual(calls.at(-1), ['step', 31, 'r1', { card: 2 }], 'the card it lands on, so the phone and the screen agree');
    assert.match(m.text(m.by('remote-card')), /Solution/);
    assert.ok(!m.by('remote-notice'));
    await m.press(m.by('remote-next-card'));
    assert.equal(m.text(m.by('remote-notice')), NOT_PRESENTING, 'PR4a: the controls stay, and it says why nothing moved');
  } finally { localStorage.removeItem('user'); await m.close(); }
});

test('PR2b, PR2c, PR4b: one answer for a bad code, too many tries, and a disconnected phone goes back to the code', async () => {
  let joins = 0;
  Object.assign(deckRemoteApi, {
    join: async () => { joins += 1; if (joins === 1) throw err(404, 'code_not_found'); if (joins === 2) throw err(429); return { deck_id: 31, remote_id: 'r1' }; },
    step: async () => { throw err(409, 'remote_not_paired'); },
  });
  api.deckGet = async () => DECK;
  const m = await mount(h(RemotePage), '/remote', { user: USER });
  try {
    await m.type(m.by('remote-box-0'), '111111');
    await m.submit(m.by('remote-boxes').parentNode);
    assert.equal(m.text(m.by('remote-problem-didnt_work')), DIDNT_WORK);
    await m.submit(m.by('remote-boxes').parentNode);
    assert.equal(m.text(m.by('remote-problem-too_many')), TOO_MANY);
    await m.submit(m.by('remote-boxes').parentNode);
    await m.press(m.by('remote-next-card'));
    assert.match(m.text(m.by('remote-disconnected')), new RegExp(DISCONNECTED.slice(0, 30)));
    await m.press(m.by('remote-enter-new'));
    assert.ok(m.by('remote-boxes'), 'back to the code');
  } finally { localStorage.removeItem('user'); await m.close(); }
});

test('PR2d: signed out, it says to sign in and comes back with the code kept', async () => {
  const m = await mount(h(RemotePage), '/remote?code=482913');
  try {
    assert.match(m.text(m.by('remote-signed-out')), new RegExp(SIGNED_OUT));
    assert.equal(m.pr(m.by('remote-sign-in')).href, `/login?next=${encodeURIComponent('/remote?code=482913')}`);
  } finally { await m.close(); }
});

test('Present draws the pairing, and its socket turns the chip on and off', () => {
  const p = readFileSync(new URL('../src/pages/raise/pitch/PitchPresent.jsx', import.meta.url), 'utf8');
  assert.match(p, /<RemotePair deckId=\{deck\.id\} paired=\{remotePaired\}/);
  assert.match(p, /if \(frame\?\.type === 'paired'\) \{ setRemotePaired\(true\); return; \}/);
  assert.match(p, /if \(frame\?\.type === 'unpaired'\) \{ setRemotePaired\(false\); return; \}/);
  const r = readFileSync(new URL('../src/routes/remote.jsx', import.meta.url), 'utf8');
  assert.match(r, /<Route path="\/remote" element=\{<RemotePage \/>\} \/>/);
});

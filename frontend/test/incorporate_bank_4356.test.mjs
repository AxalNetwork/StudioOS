/**
 * #4356 (D4356): Incorporate's "Open a bank account" step, with Mercury.
 * Every company and connection below is made up.
 *
 *   · the step's state from `GET /api/mercury/personal/status`: done only when
 *     connected and active; a lapsed connection asks to reconnect; a failed read
 *     says so and is never done;
 *   · the Open link: the owner's referral link (config) when it is an https
 *     mercury.com address, else Mercury's public site; never an off-site link;
 *   · the timeline's bank row appears only once Filed; the Done page's card;
 *   · mounted: the step reads the founder's own Mercury status.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporate_bank_4356.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import BankStep from '../src/pages/incorporate/BankStep.jsx';
import IncorporationTimeline from '../src/pages/incorporate/IncorporationTimeline.jsx';
import IncorporateDone from '../src/pages/incorporate/IncorporateDone.jsx';
import { BANK_LINES, BANK_TITLE, MERCURY_PUBLIC_URL, bankStepOf, mercuryOpenUrl } from '../src/pages/incorporate/incorporateModel.js';

const h = React.createElement;
const wrap = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const ACTIVE = { connected: true, connection: { uid: 'mc-1', status: 'active', account_name: '[Orbit Notes Inc.]' }, uses: [] };
const LAPSED = { connected: true, connection: { uid: 'mc-1', status: 'error', account_name: '[Orbit Notes Inc.]' }, uses: [] };
const NONE = { connected: false, connection: null, uses: [] };

test('the step is done only when the founder\'s Mercury is connected and active', () => {
  assert.deepEqual(bankStepOf(ACTIVE), { kind: 'done', done: true, line: BANK_LINES.done });
  assert.deepEqual(bankStepOf(NONE), { kind: 'todo', done: false, line: BANK_LINES.todo });
  assert.equal(bankStepOf(LAPSED).kind, 'attention');
  assert.equal(bankStepOf({ connected: true, connection: { status: 'pending' } }).done, false, 'pending is not done');
  assert.equal(bankStepOf({ connected: false, connection: { status: 'active' } }).done, false, 'not connected is not done');
  assert.deepEqual(bankStepOf('unread'), { kind: 'unread', done: false, line: BANK_LINES.unread });
  assert.equal(bankStepOf(null).kind, 'unread');
  assert.equal(bankStepOf(undefined).kind, 'reading');
  assert.match(BANK_LINES.todo, /Mercury/);
});

test('the Open link: a configured https mercury.com referral, else the public site; never off-site', () => {
  assert.equal(MERCURY_PUBLIC_URL, 'https://mercury.com/');
  assert.equal(mercuryOpenUrl(''), MERCURY_PUBLIC_URL, 'unconfigured');
  assert.equal(mercuryOpenUrl(undefined), MERCURY_PUBLIC_URL);
  assert.equal(mercuryOpenUrl(' https://mercury.com/r/axal-example '), 'https://mercury.com/r/axal-example');
  assert.equal(mercuryOpenUrl('https://app.mercury.com/signup?ref=x'), 'https://app.mercury.com/signup?ref=x');
  for (const bad of ['http://mercury.com/r/x', 'https://mercury.com.evil.example/r', 'https://evilmercury.com/', 'javascript:alert(1)', 'https://u:p@mercury.com/', 'not a url']) {
    assert.equal(mercuryOpenUrl(bad), MERCURY_PUBLIC_URL, `${bad} is never linked to`);
  }
  assert.match(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'), /^VITE_MERCURY_REFERRAL_URL=$/m, 'the key is documented and blank');
});

test('the card: not done offers Open and Connect; done shows the tick and no actions; a failed read is never done', () => {
  const todo = wrap(h(BankStep, { status: NONE, configured: 'https://mercury.com/r/axal-example' }));
  assert.match(todo, /data-testid="done-bank" data-done="false" data-kind="todo"/);
  assert.match(renderedText(todo), new RegExp(`${BANK_TITLE}.*Mercury, Axal’s bank partner.*Already have a Mercury account`));
  assert.match(todo, /href="https:\/\/mercury\.com\/r\/axal-example" target="_blank" rel="noopener noreferrer"[^>]*data-testid="bank-open-mercury"/);
  assert.match(todo, /data-testid="bank-connect-mercury" href="\/account\/connectors\/mercury"[^>]*>Connect Mercury</);
  const done = wrap(h(BankStep, { status: ACTIVE }));
  assert.match(done, /data-done="true" data-kind="done"/);
  assert.match(renderedText(done), /✓ Open a bank account.*Your Mercury account is connected\./);
  assert.doesNotMatch(done, /bank-open-mercury|bank-connect-mercury/);
  assert.match(wrap(h(BankStep, { status: LAPSED })), />Reconnect Mercury</);
  const unread = wrap(h(BankStep, { status: 'unread' }));
  assert.match(unread, /data-done="false" data-kind="unread"/);
  assert.match(renderedText(unread), /could not be read/);
  assert.match(wrap(h(BankStep, { status: NONE, configured: '' })), /href="https:\/\/mercury\.com\/"/, 'the public site when unconfigured');
});

test('the timeline\'s bank row appears only once Filed; the Done page carries the card', () => {
  const paid = wrap(h(IncorporationTimeline, { order: { status: 'paid' }, projectId: 2 }));
  assert.doesNotMatch(paid, /timeline-bank/, 'not before Filed');
  const filed = wrap(h(IncorporationTimeline, { order: { status: 'filed', paid_at: '2026-10-30', packet_document_id: 5, filed_on: '2026-11-02' }, projectId: 2 }));
  assert.match(filed, /data-testid="timeline-bank"/);
  assert.ok(filed.indexOf('timeline-bank') > filed.indexOf('timeline-ein'), 'after the EIN row');
  const done = wrap(h(IncorporateDone, { order: { status: 'paid' }, projectId: 2, companyName: '[Orbit Notes Inc.]' }));
  assert.match(done, /data-testid="done-bank"/);
});

test('mounted: the step reads the founder\'s own Mercury status, and a failed read is never done', async () => {
  for (const [answer, kind] of [[ACTIVE, 'done'], [NONE, 'todo'], [null, 'unread']]) {
    const restore = installDocument();
    const previous = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (u) => {
      seen.push(new URL(String(u), 'http://x').pathname);
      if (answer === null) return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'down' }), text: async () => '{}' };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => answer, text: async () => JSON.stringify(answer) };
    };
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(h(MemoryRouter, null, h(BankStep, { variant: 'row' }))));
      for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      assert.ok(seen.includes('/api/mercury/personal/status'), `read: ${seen.join(', ')}`);
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
      const row = walk(container).map(props).find((p) => p?.['data-testid'] === 'timeline-bank');
      assert.ok(row, 'the row');
      assert.deepEqual([row['data-kind'], row['data-done']], [kind, String(kind === 'done')]);
    } finally {
      await act(async () => root.unmount());
      globalThis.fetch = previous; restore();
    }
  }
});

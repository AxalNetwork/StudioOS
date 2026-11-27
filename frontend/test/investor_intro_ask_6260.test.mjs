/**
 * D6260 (#6260) — the investor intro ask: the quota before sending, a confirm
 * step with an optional message, a 402's own sentence and plan, and the Asked
 * view's target name. D550's lock and pending rule are kept (their own suite,
 * investor_receipts_intros_d550.test.mjs, runs unchanged in meaning).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_intro_ask_6260.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountContracts } from './_contracts_dom.mjs';
import {
  introTarget, createIntroRequests, quotaFrom, quotaLine, askTargetName, askDate, INTRO_MESSAGE_MAX,
} from '../src/lib/investorIntroRequest.js';
import InvestorIntroRequest from '../src/pages/investor/InvestorIntroRequest.jsx';

const target = introTarget({ other: { id: 42, name: 'Fixture founder', role: 'founder' } });
const READY = { status: 'ready', value: { tier: 'free', quarter: '2026Q4', used: 1, cap: 3, remaining: 2 } };
const render = (props = {}) => renderToStaticMarkup(createElement(InvestorIntroRequest, {
  targets: [target], states: {}, ready: true, asked: new Set(), request: () => {}, quota: READY, ...props,
}));
const buttonDisabled = (html) => /<button[^>]*disabled=""[^>]*>Request an intro<\/button>/.test(html);

test('quota read: the control says how many asks are left before anything is sent', () => {
  const q = quotaFrom({ tier: 'free', quarter: '2026Q4', used: 1, cap: 3, remaining: 2 });
  assert.deepEqual(q, { tier: 'free', quarter: '2026Q4', used: 1, cap: 3, remaining: 2 });
  assert.equal(quotaLine(q), '2 of 3 asks left this quarter');
  const html = render();
  assert.match(html, /2 of 3 asks left this quarter/);
  assert.equal(buttonDisabled(html), false);
});

test('quota unreadable: sending is disabled and the line says why, never zero asks left', () => {
  assert.equal(quotaFrom({ tier: 'free', used: null, cap: 3 }), null);
  assert.equal(quotaFrom(null), null);
  const html = render({ quota: { status: 'unreadable', value: null } });
  assert.match(html, /Unreadable: your asks left this quarter could not be read, so an ask cannot be sent/);
  assert.doesNotMatch(html, /0 of/);
  assert.equal(buttonDisabled(html), true);
  assert.equal(buttonDisabled(render({ quota: { status: 'loading', value: null } })), true);
});

test('quota exhausted: none left disables the ask; a 402 shows the route’s sentence and the plan it names', async () => {
  const empty = render({ quota: { status: 'ready', value: { tier: 'free', quarter: '2026Q4', used: 3, cap: 3, remaining: 0 } } });
  assert.match(empty, /0 of 3 asks left this quarter\. None left to send until next quarter\./);
  assert.equal(buttonDisabled(empty), true);

  let states = {};
  let refused = null;
  const sentence = 'You have used all 3 introductions for 2026Q4.';
  const body = { error: 'quota_exceeded', code: 'quota_intros_exhausted', message: sentence, used: 3, cap: 3, tier: 'free', upgrade_to: 'plus', checkout_path: '/api/billing/investor/checkout' };
  const request = createIntroRequests(async () => { throw Object.assign(new Error(sentence), { status: 402, code: 'quota_intros_exhausted', data: body }); }, s => { states = s; }, { onRefused: (d) => { refused = d; } });
  await request(target, 'hello');
  assert.equal(states[target.key].status, 'refused');
  assert.equal(states[target.key].message, sentence);
  assert.deepEqual(states[target.key].upgrade, { to: 'plus', checkoutPath: '/api/billing/investor/checkout' });
  assert.equal(refused, body);
  assert.deepEqual(quotaFrom(refused, READY.value), { tier: 'free', quarter: '2026Q4', used: 3, cap: 3, remaining: 0 });
  const html = render({ states });
  assert.match(html, /You have used all 3 introductions for 2026Q4\./);
  assert.match(html, /<a href="\/pricing\?for=investor"[^>]*>Upgrade to Plus<\/a>/);
  assert.doesNotMatch(html, /Request pending/);
  const top = { ...states, [target.key]: { ...states[target.key], upgrade: { to: null, checkoutPath: null } } };
  assert.match(render({ states: top }), /No higher plan raises this cap\./);
  assert.doesNotMatch(render({ states: top }), /Upgrade to/);
});

function Harness({ post, onSpent }) {
  const [states, setStates] = useState({});
  const request = useMemo(() => createIntroRequests(post, setStates, { onSpent }), []);
  return createElement(InvestorIntroRequest, { targets: [target], states, request, ready: true, asked: new Set(), quota: READY });
}

test('success: the first press only opens the confirm step; Send ask posts once with the message', async () => {
  const posted = [];
  let spent = null;
  const post = async (b) => { posted.push(b); return { ok: true, uid: 'ask-1', used: 2, cap: 3, remaining: 1, tier: 'free' }; };
  const r = await mountContracts(createElement(Harness, { post, onSpent: (x) => { spent = x; } }));
  try {
    await r.click('Request an intro');
    assert.equal(posted.length, 0, 'opening the confirm step spent a quota slot');
    const text = r.text();
    assert.match(text, /An ask is not consent\./);
    assert.match(text, /neither person has agreed, and no introduction has been made/);
    assert.match(text, /Sending uses one of your 2 asks left for 2026Q4\./);
    await r.click('Cancel');
    assert.doesNotMatch(r.text(), /An ask is not consent/);
    assert.equal(posted.length, 0);
    await r.click('Request an intro');
    await r.fill('Message to go with the ask', '  We back lab tools.  ');
    assert.match(r.text(), /22 of 2,000 characters/);
    await r.click('Send ask');
    await r.flush();
    assert.deepEqual(posted, [{ founder_user_id: 42, message: 'We back lab tools.' }]);
    assert.equal(spent?.remaining, 1);
    assert.match(r.text(), /Request pending/);
    assert.doesNotMatch(r.text(), /Introduced/);
  } finally { await r.unmount(); }
});

test('the message stops at the route’s 2,000 characters and an empty one is not sent', async () => {
  assert.equal(INTRO_MESSAGE_MAX, 2000);
  const posted = [];
  const request = createIntroRequests(async (b) => { posted.push(b); return { ok: true }; }, () => {});
  await request(target, 'x'.repeat(2500));
  assert.equal(posted[0].message.length, 2000);
  const other = { ...target, key: 'founder_user_id:43', body: { founder_user_id: 43 } };
  await request(other, '   ');
  assert.deepEqual(posted[1], { founder_user_id: 43 });
});

test('the Asked view names the target, or says Not available, or that the names could not be read', () => {
  assert.equal(askTargetName({ target: { kind: 'founder', name: 'Fay Founder', available: true } }), 'Fay Founder');
  assert.equal(askTargetName({ founder_user_id: 12, target: { kind: 'founder', name: null, available: false } }), 'Not available');
  assert.equal(askTargetName({ project_id: 9, target: { kind: 'project', name: null, available: false } }), 'Not available');
  assert.equal(askTargetName({ target: { kind: 'project', name: null, available: true } }), 'Name not recorded');
  assert.equal(askTargetName({ target: { kind: null, name: null, available: false } }), 'Target not recorded');
  assert.equal(askTargetName({ target: { kind: 'founder', name: 'Fay Founder', available: true } }, true), 'Target name unreadable');
  assert.doesNotMatch(askTargetName({ founder_user_id: 12, target: null }), /#12/);
  assert.equal(askDate('2026-11-10 10:00:00'), 'Nov 10, 2026');
  assert.equal(askDate(null), 'Date not recorded');
});

test('the workspace renders the joined name, the message and the date, and reads the list at the mounted path', () => {
  const src = readFileSync(new URL('../src/pages/investor/InvestorNetworkWorkspace.jsx', import.meta.url), 'utf8');
  // D6261 moved each ask's card into InvestorAskCard.jsx; the workspace hands it the names flag.
  const card = readFileSync(new URL('../src/pages/investor/InvestorAskCard.jsx', import.meta.url), 'utf8');
  assert.match(src, /<InvestorAskCard [^>]*namesUnreadable=\{askNamesUnreadable\}/);
  assert.match(card, /askTargetName\(ask, namesUnreadable\)/);
  assert.match(card, /No message was sent with this ask\./);
  assert.match(card, /Asked \{askDate\(ask\.created_at\)\}/);
  assert.doesNotMatch(src + card, /Founder #\$\{ask/);
  assert.match(src, /quota=\{introQuota\}/);
  const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /listIntroductions: \(\) => request\('\/introductions'\)/);
});

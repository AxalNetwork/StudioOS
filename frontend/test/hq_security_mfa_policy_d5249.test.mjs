/**
 * D5249 (#5249) — "Require MFA for admins" on the Security Overview.
 *
 * What a Super Admin sees: the policy's own state from the server (On, Off,
 * Unavailable — never Off for a read that failed), a switch only for them,
 * a reason required inside the dialog, and a state that moves only on the
 * server's reply: a refused change (409 actor_without_mfa, 503) is said and
 * leaves the badge where it was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import { adminMfaPolicyApi } from '../src/lib/api.js';
import { buildOverview } from '../src/pages/hq/security/overviewModel.js';
import OverviewWorkspace from '../src/pages/hq/security/OverviewWorkspace.jsx';
import { readFileSync } from 'node:fs';
import { mfaPolicyView, mfaPolicyRefusal, withoutMfaLine, changeMfaPolicy } from '../src/pages/hq/security/mfaPolicyModel.js';

const h = React.createElement;
const AT = '2026-11-11T12:00:00.000Z';
const UNAVAILABLE = Symbol('unavailable');
const OFF = () => ({ enabled: false, readable: true, updated_at: null, updated_by: null, admins_without_mfa: 2 });
const ON = () => ({ enabled: true, readable: true, updated_at: '2026-11-11T11:30:00Z', updated_by: 'sam@example.com', admins_without_mfa: 2 });

const modelWith = (mfa) => buildOverview({
  overview: { state: 'ready', value: { mfa }, at: AT },
  feed: { state: 'loading' },
});
const GAP = () => modelWith({ admins_total: 3, admins_with_mfa: 1, admins_without_mfa: [] });
const NO_GAP = () => modelWith({ admins_total: 2, admins_with_mfa: 2 });

const html = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { onRetry: {}, model: GAP(), ...props })));
const between = (s, start, end) => { const i = s.indexOf(start); assert.ok(i >= 0, `missing ${start}`); return s.slice(i, s.indexOf(end, i)); };
const superProps = (extra = {}) => ({ isSuper: true, unavailable: UNAVAILABLE, onSet: async () => ({}), onRetry: () => {}, ...extra });

// ───────────────────────────────────────────────────────────── the model ──

test('D5249 model: Off, On and Unavailable come from the read; a failed or partial read is never Off', () => {
  assert.equal(mfaPolicyView(null, UNAVAILABLE).state, 'loading');
  assert.deepEqual([mfaPolicyView(OFF(), UNAVAILABLE).state, mfaPolicyView(OFF(), UNAVAILABLE).word], ['off', 'Off']);
  assert.deepEqual([mfaPolicyView(ON(), UNAVAILABLE).state, mfaPolicyView(ON(), UNAVAILABLE).word], ['on', 'On']);
  for (const bad of [UNAVAILABLE, { ...OFF(), readable: false }, { readable: true }, { enabled: 'false', readable: true }]) {
    const v = mfaPolicyView(bad, UNAVAILABLE);
    assert.equal(v.state, 'unreadable', JSON.stringify(bad));
    assert.equal(v.badge, 'unavailable');
    assert.doesNotMatch(v.text, /\bnot enforced\b/i);
  }
  assert.match(mfaPolicyView(OFF(), UNAVAILABLE).text, /password alone/);
});

test('D5249 model: the enrol count is never 0 when unread; refusals say what happened', () => {
  assert.match(withoutMfaLine({ admins_without_mfa: null }), /could not be read/);
  assert.match(withoutMfaLine({ admins_without_mfa: 0 }), /sends no one to enrol/);
  assert.match(withoutMfaLine({ admins_without_mfa: 1 }), /^1 active administrator without MFA/);
  assert.match(mfaPolicyRefusal({ status: 409, code: 'actor_without_mfa' }), /enrol MFA on your own account first/);
  assert.match(mfaPolicyRefusal({ status: 503, code: 'store_unavailable' }), /Nothing was changed/);
  assert.match(mfaPolicyRefusal({ status: 403, code: 'step_up_required' }), /fresh step-up/);
  assert.match(mfaPolicyRefusal(new Error('network')), /Outcome unknown/);
});

// ─────────────────────────────────────────────────────── server renders ──

test('D5249 render: on the MFA finding, a Super Admin sees Off by default with Turn on…', () => {
  const out = html({ mfaPolicy: OFF(), mfaPolicyProps: superProps() });
  const row = between(out, 'data-testid="security-finding-mfa-gap"', '</li>');
  assert.match(row, /data-testid="mfa-policy" data-state="off"/);
  assert.match(renderedText(row), /Require MFA for admins/);
  assert.match(renderedText(row), /Off/);
  assert.match(renderedText(row), /Turn on…/);
  assert.doesNotMatch(out, /data-testid="security-mfa-policy-section"/, 'a second copy outside the finding');
});

test('D5249 render: On shows who changed it and Turn off…; Unavailable shows Retry and no switch', () => {
  const on = renderedText(between(html({ mfaPolicy: ON(), mfaPolicyProps: superProps() }), 'data-testid="mfa-policy"', '</li>'));
  assert.match(on, /On/);
  assert.match(on, /Last changed 2026-11-11 11:30 UTC by sam@example\.com/);
  assert.match(on, /Turn off…/);

  const un = html({ mfaPolicy: UNAVAILABLE, mfaPolicyProps: superProps() });
  const box = between(un, 'data-testid="mfa-policy"', '</li>');
  assert.match(box, /data-state="unreadable"/);
  assert.match(renderedText(box), /Unavailable/);
  assert.match(renderedText(box), /Retry/);
  assert.doesNotMatch(renderedText(box), /Turn (on|off)…|\bOff\b/);
});

test('D5249 render: a plain admin gets no control; with no open gap a Super Admin still finds it', () => {
  assert.doesNotMatch(html({ mfaPolicy: OFF(), mfaPolicyProps: superProps({ isSuper: false }) }), /data-testid="mfa-policy"/);
  assert.doesNotMatch(html({}), /data-testid="mfa-policy"/);
  assert.doesNotMatch(html({ model: NO_GAP(), mfaPolicy: OFF(), mfaPolicyProps: superProps({ isSuper: false }) }), /security-mfa-policy-section|Administrator MFA</, 'a plain admin got the empty MFA section');
  const clear = html({ model: NO_GAP(), mfaPolicy: OFF(), mfaPolicyProps: superProps() });
  assert.match(between(clear, 'data-testid="security-mfa-policy-section"', '</section>'), /data-testid="mfa-policy" data-state="off"/);
});

test('D5249 client: the module reads and writes the Worker route with the reason', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([String(url), init.method || 'GET', init.body || null]);
    return new Response(JSON.stringify(OFF()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await adminMfaPolicyApi.get();
    await adminMfaPolicyApi.set(true, 'Policy rollout');
  } finally { globalThis.fetch = prev; }
  assert.match(seen[0][0], /\/api\/admin\/security\/mfa-policy$/);
  assert.equal(seen[0][1], 'GET');
  assert.equal(seen[1][1], 'PUT');
  assert.deepEqual(JSON.parse(seen[1][2]), { enabled: true, reason: 'Policy rollout' });
});

test('D5249 page: SecurityPage changes the policy through changeMfaPolicy and reads it only for a Super Admin', async () => {
  const src = readFileSync(new URL('../src/pages/hq/SecurityPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /changeMfaPolicy\(\{ put: adminMfaPolicyApi\.set, setPolicy: setMfaPolicy, reload: loadMfaPolicy \}/);
  assert.match(src, /if \(!isSuper\) return;\s*const current = latest\('mfaPolicy'\)/);
  const set = [];
  const reloaded = [];
  await changeMfaPolicy({ put: async () => ({ changed: true }), setPolicy: (p) => set.push(p), reload: () => reloaded.push(1) }, true, 'x');
  assert.deepEqual([set.length, reloaded.length], [0, 1], 'a reply without a boolean was drawn instead of re-read');
  await assert.rejects(changeMfaPolicy({ put: async () => { throw new Error('no'); }, setPolicy: (p) => set.push(p), reload: () => reloaded.push(1) }, true, 'x'));
  assert.equal(set.length, 0, 'a failed change moved the state');
});

// ─────────────────────────────────────────────────────── mounted journey ──

/** The page's own rule, the same function SecurityPage.jsx calls: state moves only on the server's reply. */
function Harness({ initial, put, calls }) {
  const [policy, setPolicy] = useState(initial);
  const onSet = (enabled, reason) => {
    calls.push([enabled, reason]);
    return changeMfaPolicy({ put, setPolicy, reload: () => setPolicy(null) }, enabled, reason);
  };
  return h(MemoryRouter, null, h(OverviewWorkspace, {
    model: GAP(), onRetry: {}, mfaPolicy: policy, mfaPolicyProps: superProps({ onSet }),
  }));
}

async function mount(initial, put) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  const calls = [];
  await act(async () => { r.render(h(Harness, { initial, put, calls })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const text = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join(''));
  const byId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const click = async (n) => { await act(async () => { props(n).onClick({ currentTarget: n, preventDefault() {} }); }); };
  const type = async (n, value) => { await act(async () => { props(n).onChange({ target: { value } }); }); };
  return { byId, props, text, click, type, calls, done: async () => { await act(async () => r.unmount()); } };
}

const REASON = 'Rolling out admin MFA';

test('mounted: a reason is required before Review, and nothing is sent without one', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount(OFF(), async () => ON());
  try {
    await m.click(m.byId('mfa-policy-change'));
    assert.ok(m.byId('mfa-policy-dialog'), 'no dialog');
    await m.click(m.byId('mfa-policy-next'));
    assert.match(m.text(m.byId('mfa-policy-dialog')), /Give a reason of at least 8 characters/);
    assert.equal(m.byId('mfa-policy-review'), undefined, 'reached Review without a reason');
    assert.equal(m.calls.length, 0);
  } finally { await m.done(); restore(); }
});

test('mounted: 409 actor_without_mfa is said, and the badge stays Off — never On after a failed PUT', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount(OFF(), async () => { const e = new Error('refused'); e.status = 409; e.code = 'actor_without_mfa'; throw e; });
  try {
    await m.click(m.byId('mfa-policy-change'));
    await m.type(m.byId('action-reason'), REASON);
    await m.click(m.byId('mfa-policy-next'));
    assert.match(m.text(m.byId('mfa-policy-review')), /Off → On/);
    await m.click(m.byId('mfa-policy-confirm'));
    assert.deepEqual(m.calls, [[true, REASON]]);
    const result = m.byId('mfa-policy-result');
    assert.equal(m.props(result)['data-ok'], 'false');
    assert.match(m.text(result), /enrol MFA on your own account first/);
    assert.equal(m.props(m.byId('mfa-policy'))['data-state'], 'off', 'a refused change moved the badge');
  } finally { await m.done(); restore(); }
});

test('mounted: a 503 says nothing was changed; a confirmed reply turns the badge On', async () => {
  const restore = installDocument('', { focus: true });
  const failing = await mount(OFF(), async () => { const e = new Error('x'); e.status = 503; e.code = 'store_unavailable'; throw e; });
  try {
    await failing.click(failing.byId('mfa-policy-change'));
    await failing.type(failing.byId('action-reason'), REASON);
    await failing.click(failing.byId('mfa-policy-next'));
    await failing.click(failing.byId('mfa-policy-confirm'));
    assert.match(failing.text(failing.byId('mfa-policy-result')), /Nothing was changed/);
    assert.equal(failing.props(failing.byId('mfa-policy'))['data-state'], 'off');
  } finally { await failing.done(); }

  const ok = await mount(OFF(), async () => ON());
  try {
    await ok.click(ok.byId('mfa-policy-change'));
    await ok.type(ok.byId('action-reason'), REASON);
    await ok.click(ok.byId('mfa-policy-next'));
    await ok.click(ok.byId('mfa-policy-confirm'));
    assert.equal(ok.props(ok.byId('mfa-policy-result'))['data-ok'], 'true');
    assert.equal(ok.props(ok.byId('mfa-policy'))['data-state'], 'on');
  } finally { await ok.done(); restore(); }
});

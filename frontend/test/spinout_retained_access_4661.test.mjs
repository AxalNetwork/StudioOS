// #4661: retained access and the cards that agree with their destinations.
//   · a graduate of ANY role keeps their own certificate after enrollment ends: the route admits any signed-in
//     account, and the page opens from the Worker's graduation rule or the member's own credential;
//   · a failed read of those is "could not be read", never the locked view that says "not yet";
//   · an exited founder's tool cards are closed, because every tool route refuses them (leaving the programme
//     clears `spinout_lab_active`), and a card that stayed enabled would open a page that bounces them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import SpinoutLabCertificatePage from '../src/pages/SpinoutLabCertificatePage.jsx';
import Workspace, { TOOL_INFO } from '../src/pages/SpinoutLabWorkspace.jsx';

const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const down = () => reply({ error: 'unavailable', message: 'Down.' }, 503);
const CREDENTIAL = { id: 9, credential_id: 'AXAL-2026-0117', public_token: 'tok-synthetic-0001', status: 'issued', issued_at: '2026-10-28 10:00:00', public_company: 'Synthetic Robotics' };
const EXPLORER = { id: 117, role: 'exploring', name: 'Synthetic Explorer', email: 'explorer@example.test' };
// A graduate whose enrollment ended: not active, no `unlocked_features`, not "incorporated" by the old signal.
const CONFERRED = [{ key: 'incorporation_completed', completed_at: '2026-10-28 10:00:00' }];
const GRADUATE_STATE = { active: false, is_incorporated: false, graduated: true, week: 4, milestones: CONFERRED, unlocked_features: [] };
const NOT_GRADUATE = { active: true, is_incorporated: false, graduated: false, week: 2, milestones: [], unlocked_features: [] };

async function mountCertificate(routes) {
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^.*\/api/, '').split('?')[0];
    const handler = routes[path];
    return handler ? handler() : reply({}, 404);
  };
  const m = await mountForm(h(SpinoutLabCertificatePage));
  const settle = async () => { await m.flush(); await m.flush(); };
  await settle();
  return { m, settle, async close() { await m.unmount(); globalThis.fetch = before; } };
}
const base = (state, certificate) => ({
  '/spinout-lab/state': state,
  '/auth/me': () => reply(EXPLORER),
  '/projects': () => reply([]),
  '/spinout-lab/certificates/mine': certificate,
});

test('a graduate of any role keeps their certificate: the Worker\'s graduation rule and their own credential open it', async () => {
  const t = await mountCertificate(base(() => reply(GRADUATE_STATE), () => reply({ certificate: CREDENTIAL })));
  try {
    assert.equal(t.m.by('page-locked'), undefined, 'a graduate is not told it unlocks in Week 4');
    assert.ok(t.m.by('page-spinout-certificate'), 'the certificate page opens');
    assert.match(t.m.text(), /AXAL-2026-0117/);
  } finally { await t.close(); }
  // The credential alone is enough when the state cannot say (the registry is the member's own).
  const t2 = await mountCertificate(base(() => reply({ active: false, is_incorporated: false, week: 4, milestones: CONFERRED, unlocked_features: [] }), () => reply({ certificate: CREDENTIAL })));
  try { assert.ok(t2.m.by('page-spinout-certificate')); } finally { await t2.close(); }
  // And the graduation rule alone is enough before a registry row exists.
  const t3 = await mountCertificate(base(() => reply(GRADUATE_STATE), () => reply({ certificate: null })));
  try { assert.ok(t3.m.by('page-spinout-certificate'), 'a graduate with no registry row yet is not locked out'); } finally { await t3.close(); }
});

test('a member who is not a graduate still meets the locked view', async () => {
  const t = await mountCertificate(base(() => reply(NOT_GRADUATE), () => reply({ certificate: null })));
  try {
    assert.ok(t.m.by('page-locked'));
    assert.equal(t.m.by('page-spinout-certificate'), undefined);
    assert.equal(t.m.by('page-unreadable'), undefined, 'a read that worked is not unreadable');
  } finally { await t.close(); }
});

test('a failed read is "could not be read", never the locked view, and a retry reads again', async () => {
  let reads = 0;
  const t = await mountCertificate(base(() => { reads += 1; return reads === 1 ? down() : reply(GRADUATE_STATE); }, () => reply({ certificate: CREDENTIAL })));
  try {
    // The credential read worked here, so the page opens from it even while the state is down.
    assert.ok(t.m.by('page-spinout-certificate'), 'a credential of their own is enough');
  } finally { await t.close(); }
  let stateReads = 0;
  let certReads = 0;
  const t2 = await mountCertificate(base(
    () => { stateReads += 1; return stateReads === 1 ? down() : reply(GRADUATE_STATE); },
    () => { certReads += 1; return certReads === 1 ? down() : reply({ certificate: CREDENTIAL }); },
  ));
  try {
    assert.ok(t2.m.by('page-unreadable'), 'both reads failed: it says it could not read them');
    assert.equal(t2.m.by('page-locked'), undefined, 'not drawn as "not yet"');
    assert.match(t2.m.text(), /This is not a statement that you have none/);
    await act(async () => propsOf(t2.m.by('button-retry')).onClick({ preventDefault() {} })); await t2.settle();
    assert.equal(stateReads, 2, 'the retry read the state again');
    assert.equal(t2.m.by('page-unreadable'), undefined);
    assert.ok(t2.m.by('page-spinout-certificate'), 'a recovered read opens the certificate');
  } finally { await t2.close(); }
});

test('either read failing alone, with nothing else to open it, is "could not be read" too', async () => {
  const stateDown = await mountCertificate(base(down, () => reply({ certificate: null })));
  try { assert.ok(stateDown.m.by('page-unreadable'), 'the state read failed and there is no credential'); assert.equal(stateDown.m.by('page-locked'), undefined); } finally { await stateDown.close(); }
  const registryDown = await mountCertificate(base(() => reply(NOT_GRADUATE), down));
  try { assert.ok(registryDown.m.by('page-unreadable'), 'the registry read failed'); assert.equal(registryDown.m.by('page-locked'), undefined); } finally { await registryDown.close(); }
});

test('the route admits any signed-in account, not only the founder and admin roles', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/spinout-lab\/certificate" element=\{authOnly\(<SpinoutLabCertificatePage \/>\)\} \/>/);
  assert.doesNotMatch(app, /\/spinout-lab\/certificate" element=\{guard\(/, 'a role gate took an Explorer graduate\'s certificate away');
});

const html = (state) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Workspace, { state })));
function card(markup, key) {
  const at = markup.indexOf(`data-testid="workspace-tool-${key}"`);
  assert.ok(at >= 0, `no card for ${key}`);
  const next = markup.indexOf('data-testid="workspace-tool-', at + 1);
  return markup.slice(at, next < 0 ? undefined : next);
}
const ALL = Object.keys(TOOL_INFO);
const EXITED = { active: false, is_incorporated: true, graduated: false, week: 2, milestones: [], unlocked_features: ALL };
const ACTIVE = { active: true, is_incorporated: false, graduated: false, week: 4, milestones: [], unlocked_features: ALL };

test('an exited founder\'s tool cards are closed and say so; an active member\'s open', () => {
  const exited = html(EXITED);
  assert.ok(exited.includes('Left the programme in Week 2'));
  const startup = card(exited, 'projects');
  assert.ok(startup.includes('Closed after leaving'), 'the card says why it is closed');
  assert.ok(!startup.includes('>Active<') && !startup.includes('>Open'), 'an exited founder is offered a page that would bounce them');
  assert.ok(!card(exited, 'certificate').includes('>Active<'), 'an exited founder did not graduate: no certificate');
  const active = html(ACTIVE);
  assert.ok(card(active, 'projects').includes('>Active<'), 'an active member keeps their tools');
  assert.ok(!active.includes('Closed after leaving'));
});

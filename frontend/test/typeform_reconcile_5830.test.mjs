/** #5830 (D5830 part 2): the deletion-reconcile trigger in TypeformJourney, with its ok, partly, busy, stopped and refused states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import TypeformJourney from '../src/pages/cycles/TypeformJourney.jsx';
import { reconcileNotice } from '../src/pages/cycles/typeformJourneyModel.js';

const h = React.createElement;
const survey = { capability: { can_bind: true }, binding: { own: true, form_id: 'FormFixture', access_state: 'ok', fields: [{ id: 'q1', type: 'yes_no', ref: 'intent' }] }, forms: { items: [], page_count: 1 } };
const baseStatus = { state: 'ok', completed: 3, qualifying: 2, checkpoint: '2026-10-09', needs_remap: [], last_reconciled_at: null, reconcile_in_progress: false }; // Synthetic source date
const reply = (outcome, result = {}) => ({ ok: true, project_id: 41, outcome, result: { outcome, lookups: 1, checked: 0, missing_once: 0, provider_deleted: 0, reappeared: 0, ...result } });
const surveyApi = (overrides = {}) => ({ forms: async () => survey, syncStatus: async () => ({ status: baseStatus }), reviews: async () => ({ counts: { confirmed_signals: 1 }, rows: [] }), mappings: async () => ({ items: [], revision: 'synthetic-revision' }), sync: async () => ({ outcome: 'ok' }), reconcile: async () => reply('ok'), ...overrides });
async function mounted(api, Component = TypeformJourney) { const m = await mountContracts(h(Component, { projectId: 41, api }), '/validate/customer-research?project_id=41', { id: 10, role: 'founder' }); await m.flush(); await m.flush(); return m; }
const button = (m, label) => m.nodes().find(n => n.tagName === 'BUTTON' && m.props(n)?.children === label);

test('nothing reconciles on mount; one explicit click runs one pass step for this venture and says what it concluded', async () => {
  const calls = [];
  let status = baseStatus;
  const api = surveyApi({ syncStatus: async () => ({ status }), reconcile: async project => { calls.push(project); status = { ...baseStatus, completed: 2, last_reconciled_at: '2026-10-10T08:00:00Z' }; return reply('ok', { checked: 3, provider_deleted: 1, missing_once: 1, reappeared: 0 }); } });
  const m = await mounted(api);
  try {
    assert.deepEqual(calls, []);
    assert.match(m.text(), /Last deleted-response check: Not recorded\. A response deleted in Typeform is withdrawn here/);
    await m.click('Check for deleted responses'); await m.flush(); await m.flush();
    assert.deepEqual(calls, [41]);
    assert.match(m.text(), /Deleted-response check finished\. Checked 3 imported responses with Typeform; 1 confirmed deleted \(their answers and evidence were withdrawn\); 1 missing for the first time, deleted only if still missing an hour from now; 0 back again\./);
    assert.doesNotMatch(m.text(), /Import outcome/);
    assert.match(m.text(), /Last deleted-response check: 2026-10-10T08:00:00Z/);
    assert.match(m.text(), /Completed submissions2/);
  } finally { await m.unmount(); }
});

test('a partly run says the pass is unfinished and offers to continue it, never claiming the check finished', async () => {
  let status = baseStatus;
  const api = surveyApi({ syncStatus: async () => ({ status }), reconcile: async () => { status = { ...baseStatus, reconcile_in_progress: true }; return reply('partly', { lookups: 8, checked: 200 }); } });
  const m = await mounted(api);
  try {
    await m.click('Check for deleted responses'); await m.flush(); await m.flush();
    assert.match(m.text(), /Deleted-response check is part way\. Checked 200 imported responses/);
    assert.match(m.text(), /Choose Continue deleted-response check to check the rest/);
    assert.doesNotMatch(m.text(), /check finished/);
    assert.ok(button(m, 'Continue deleted-response check'));
    assert.equal(button(m, 'Check for deleted responses'), undefined);
    assert.match(m.text(), /A check is part way; continue it to check the rest/);
  } finally { await m.unmount(); }
});

test('busy and stopped runs conclude nothing and are not reported as a finished check or an import', async () => {
  for (const [outcome, said] of [['busy', /already running for this form/], ['rate_limited', /stopped before it finished\. Nothing unread was marked deleted/], ['not_selected', /stopped before it finished/]]) {
    const m = await mounted(surveyApi({ reconcile: async () => reply(outcome) }));
    try {
      await m.click('Check for deleted responses'); await m.flush(); await m.flush();
      assert.match(m.text(), said, outcome);
      assert.doesNotMatch(m.text(), /check finished|Import outcome/, outcome);
    } finally { await m.unmount(); }
  }
});

test('refusals show the house sentence, never the raw detail, and leave the counts on screen', async () => {
  for (const [code, said] of [['not_your_binding', /Only the member whose Typeform serves this venture/], ['binding_lost', /Reconnect Typeform and check the form’s access/], ['typeform_unavailable', /unavailable until its app is approved/], ['not_bound', /Choose a Typeform form for this venture first/], ['read_only', /Unreadable or refused/]]) {
    const m = await mounted(surveyApi({ reconcile: async () => { throw { status: 409, data: { error: code, detail: 'RAW SERVER DETAIL' } }; } }));
    try {
      await m.click('Check for deleted responses'); await m.flush(); await m.flush();
      assert.match(m.text(), said, code);
      assert.doesNotMatch(m.text(), /RAW SERVER DETAIL|Deleted-response check/, code);
      assert.match(m.text(), /Completed submissions3/, code);
    } finally { await m.unmount(); }
  }
});

test('only the binding owner with readable access sees the trigger', async () => {
  for (const forms of [{ ...survey, binding: { ...survey.binding, own: false } }, { ...survey, binding: { ...survey.binding, access_state: 'lost' } }]) {
    let runs = 0;
    const m = await mounted(surveyApi({ forms: async () => forms, reconcile: async () => { runs++; return reply('ok'); } }));
    try { assert.equal(button(m, 'Check for deleted responses'), undefined); assert.equal(runs, 0); }
    finally { await m.unmount(); }
  }
});

test('reconcileNotice never invents counts from a missing or malformed result', () => {
  assert.match(reconcileNotice({ outcome: 'ok' }), /Checked 0 imported responses.*0 confirmed deleted/);
  assert.match(reconcileNotice({ outcome: 'ok', result: { checked: -1, provider_deleted: 1.5 } }), /Checked 0 .*; 0 confirmed deleted/);
  assert.match(reconcileNotice(null), /stopped before it finished/);
});

test('mutations: the reconcile states, the trigger wiring and the continue label are each caught', async () => {
  let path = 'pages/cycles/typeformJourneyModel.js';
  await mutationCheck(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'), path, mod => {
    assert.match(mod.reconcileNotice(reply('ok', { checked: 4, provider_deleted: 2, missing_once: 1, reappeared: 1 })), /^Deleted-response check finished\. Checked 4 .*; 2 confirmed deleted .*; 1 missing .*; 1 back again\.$/);
    assert.match(mod.reconcileNotice(reply('partly')), /part way.*Continue deleted-response check/);
    assert.doesNotMatch(mod.reconcileNotice(reply('partly')), /finished/);
    assert.match(mod.reconcileNotice(reply('busy')), /already running/);
    assert.match(mod.reconcileNotice(reply('stopped')), /stopped before it finished/);
    assert.match(mod.reconcileNotice(reply('ok', { checked: null })), /Checked 0 /);
  }, [
    ["if (reply?.outcome === 'ok')", "if (reply?.outcome === 'ok' || reply?.outcome === 'partly')"],
    ["if (reply?.outcome === 'partly')", "if (reply?.outcome === 'stopped')"],
    ["if (reply?.outcome === 'busy')", "if (reply?.outcome === 'stopped')"],
    ['${n(r.provider_deleted)} confirmed', '${n(r.missing_once)} confirmed'],
    ['Number.isSafeInteger(v) && v >= 0 ? v : 0', 'v'],
  ]);
  path = 'pages/cycles/TypeformJourney.jsx';
  await mutationCheck(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'), path, async mod => {
    const calls = [];
    let status = baseStatus;
    const m = await mounted(surveyApi({ syncStatus: async () => ({ status }), reconcile: async p => { calls.push(p); status = { ...baseStatus, reconcile_in_progress: true }; return reply('partly', { checked: 2 }); } }), mod.default);
    try {
      assert.deepEqual(calls, []);
      await m.click('Check for deleted responses'); await m.flush(); await m.flush();
      assert.deepEqual(calls, [41]);
      assert.match(m.text(), /Deleted-response check is part way/);
      assert.ok(button(m, 'Continue deleted-response check'));
    } finally { await m.unmount(); }
  }, [
    ['run(() => api.reconcile(projectId), true, true, reconcileNotice)', 'run(() => api.reconcile(projectId))'],
    ['run(() => api.reconcile(projectId), true, true, reconcileNotice)', 'run(() => api.sync(projectId), true, true, reconcileNotice)'],
    ["status?.reconcile_in_progress ? 'Continue deleted-response check'", "false ? 'Continue deleted-response check'"],
    ['const said = describe(result); if (said) setNotice(said);', ''],
  ]);
});

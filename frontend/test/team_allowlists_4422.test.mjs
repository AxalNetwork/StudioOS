/** D4422 (#4422): actual Team card reads and saves through the adapter, with honest failures and inherited edit gates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import TeamAllowlists from '../src/pages/team/TeamAllowlists.jsx';

const MODEL = 'model-a';
const G = { integration_uid: 'c'.repeat(32), tool: 'read_ledger' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mount(over = {}, failRead = false) {
  const previous = globalThis.fetch;
  let value = { model_ids: null, tool_grants: null, inherited: true, can_manage: true,
    scope: { kind: 'company', id: 'co-1', name: 'Acme' },
    models: [{ id: MODEL, label: 'Model A', plan_locked: false }, { id: 'locked', label: 'Model B', plan_locked: true }],
    servers: [{ integration_uid: G.integration_uid, name: 'Ledger', tools: [{ name: G.tool }] }], ...over };
  let fail = false;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET') return failRead ? json({ error: 'unavailable' }, 503) : json(value);
    if (fail) return json({ error: 'model_not_allowed', message: 'This model is no longer allowed on your plan.' }, 403);
    value = { ...value, ...JSON.parse(opts.body) };
    return json({ ok: true });
  };
  const v = await mountContracts(React.createElement(TeamAllowlists, { scope: 'project', id: 7 }));
  const settle = async () => { for (let i = 0; i < 4; i++) await v.flush(); };
  await settle();
  const by = (id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
  return { ...v, by, calls, settle, failSave: () => { fail = true; },
    toggle: async (id, checked) => { const n = by(id); assert.ok(n, id); await act(async () => v.props(n).onChange({ target: { checked } })); await settle(); },
    close: async () => { await v.unmount(); globalThis.fetch = previous; } };
}

test('reads inherited company defaults, models before tools, narrows both lists and saves the exact selection', async () => {
  const v = await mount();
  try {
    assert.match(v.text(), /Inherited from Acme/);
    assert.match(v.text(), /Plan default/);
    assert.ok(v.text().indexOf('Models') < v.text().indexOf('MCP servers and tools'));
    assert.equal(v.props(v.by('allowlists-model-default')).checked, true);
    assert.equal(v.props(v.by('allowlists-model-locked')).disabled, true);
    await v.toggle('allowlists-model-default', false);
    await v.toggle('allowlists-tool-default', false);
    await v.toggle(`allowlists-tool-${G.integration_uid}-${G.tool}`, false);
    await v.click('Save'); await v.settle();
    assert.deepEqual(v.calls.find((c) => c.method === 'PUT'), { url: '/api/teams/project/7/allowlists', method: 'PUT', body: { model_ids: [MODEL], tool_grants: [] } });
    assert.match(v.text(), /Allowed models and tools saved/);
    assert.equal(v.props(v.by('allowlists-model-default')).checked, false);
    assert.match(v.text(), /No tools allowed/);
    await v.toggle('allowlists-model-default', true);
    await v.toggle('allowlists-tool-default', true);
    await v.click('Save'); await v.settle();
    assert.deepEqual(v.calls.filter((c) => c.method === 'PUT').at(-1).body, { model_ids: null, tool_grants: null });
  } finally { await v.close(); }
});

test('read-only inherited policy has disabled fields and no Save even for a project manager', async () => {
  const v = await mount({ can_manage: false, model_ids: [MODEL], tool_grants: [G] });
  try {
    assert.match(v.text(), /Only Acme’s editors can change this/);
    assert.equal(Boolean(v.by('allowlists-save')), false);
    assert.ok(v.nodes().filter((n) => n.tagName === 'FIELDSET').every((n) => v.props(n).disabled));
    assert.equal(v.props(v.by('allowlists-model-default')).checked, false);
    assert.equal(v.props(v.by(`allowlists-tool-${G.integration_uid}-${G.tool}`)).checked, true);
    assert.equal(v.calls.some((c) => c.method === 'PUT'), false);
  } finally { await v.close(); }
});

test('read failure is Unreadable, while a refused save keeps the choices and gives the Worker reason', async () => {
  const unreadable = await mount({}, true);
  try {
    assert.match(unreadable.text(), /Unreadable/);
    assert.equal(Boolean(unreadable.by('allowlists-save')), false);
    assert.doesNotMatch(unreadable.text(), /No models allowed|No tools allowed/);
  } finally { await unreadable.close(); }
  const v = await mount();
  try {
    await v.toggle('allowlists-model-default', false);
    await v.toggle(`allowlists-model-${MODEL}`, false);
    v.failSave(); await v.click('Save'); await v.settle();
    assert.match(v.text(), /This model is no longer allowed on your plan/);
    assert.match(v.text(), /Your changes are still here/);
    assert.equal(v.props(v.by(`allowlists-model-${MODEL}`)).checked, false);
    assert.doesNotMatch(v.text(), /Allowed models and tools saved/);
  } finally { await v.close(); }
});

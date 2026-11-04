// D4424: the existing Team row/profile for a connected outside app; no invented persona or platform budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import AgentProfileSheet, { AgentProfile } from '../src/pages/team/AgentProfileSheet.jsx';
import TeamSettingsTab from '../src/pages/team/TeamSettingsTab.jsx';
import { agentRow, spendLine } from '../src/pages/team/teamModel.js';

const h = React.createElement;
const agent = { uid: 'outside-app', source: 'mcp_client', first_name: 'Connected assistant', last_name: null, persona: null,
  role_key: 'cpo', model_id: 'external', monthly_cap_microusd: null, month_spend: { available: false }, status: 'active', tools: [] };
const text = (node) => renderedText(renderToStaticMarkup(node));

test('the existing agent row and profile show the connected app and its own-model billing', () => {
  assert.equal(spendLine(agent), 'Runs on your own assistant');
  const row = agentRow(agent);
  assert.equal(row.name, 'Connected assistant'); assert.equal(row.outside, true); assert.equal(row.role, 'Connected app');
  const card = text(h(AgentsCard, { block: { available: true, value: { agents: [agent] } }, kind: 'company' }));
  assert.match(card, /Connected app/); assert.match(card, /Runs on your own assistant/); assert.doesNotMatch(card, /Platform model|\$0/);
  const profile = text(h(AgentProfile, { data: { agent, month_spend: { available: false } } }));
  assert.match(profile, /Connected assistant/); assert.match(profile, /Runs on your own assistant/);
  assert.doesNotMatch(profile, /Who this agent is was not recorded|\$0/);
  const settings = renderToStaticMarkup(h(MemoryRouter, null, h(TeamSettingsTab, { scope: { kind: 'company', company: { uid: 'company-a' } }, canManage: true,
    agentsBlock: { available: true, value: { agents: [agent] } } })));
  assert.match(settings, /Not applicable/); assert.match(settings, /Runs on your own assistant/);
  assert.doesNotMatch(settings, /team-settings-edit-cap-outside-app/);
});

test('mounted outside profile hides platform controls, retains Pause/Remove and confirms disconnection before writing', async () => {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder' }));
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const path = new URL(String(u), 'http://x').pathname;
    seen.push(`${init.method || 'GET'} ${path}`);
    const data = path.endsWith('/personas') ? { personas: [], values: [] }
      : init.method === 'DELETE' ? { ok: true }
        : { agent, can_manage: true, matrix: [], events: [], month_spend: { available: false } };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find(n => props(n)?.['data-testid'] === id);
  const textOf = (n) => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '';
  const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
  const click = async (id) => { const node = byId(id); assert.equal(Boolean(node), true, id); await act(async () => props(node).onClick()); await settle(); };
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(AgentProfileSheet, { uid: agent.uid, canManage: true, editCap: true, onClose() {} }))));
    await settle();
    assert.match(textOf(document.body), /Runs on your own assistant/);
    for (const id of ['agent-edit-cap', 'agent-change-sponsor', 'agent-cap-editor']) assert.equal(Boolean(byId(id)), false, id);
    assert.equal(Boolean(byId('agent-pause')), true); assert.equal(Boolean(byId('agent-remove')), true);
    await click('agent-remove'); assert.match(textOf(document.body), /connected app is disconnected/);
    assert.equal(seen.some(s => s.startsWith('DELETE ')), false);
    await click('agent-remove-confirm-yes'); assert.equal(seen.includes(`DELETE /api/teams/agents/${agent.uid}`), true);
  } finally { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); }
});

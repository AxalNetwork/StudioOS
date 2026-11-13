// D4387 (#4387, #3742 E8) — Team: Choose a new sponsor, and the cap pill's
// resume day.
//
//   · the cap pill reads `resumes_at` from the Worker, never a date of its own;
//   · TM9b's "Choose a new sponsor" opens the profile on the sponsor dialog,
//     "Raise the cap" on Edit cap;
//   · the dialog lists the Worker's candidates, offers only those who can
//     sponsor, needs a reason of 10 characters and the tools ticked, sends
//     `PUT /api/teams/agents/:uid/sponsor`, and draws a refusal in the
//     Worker's words;
//   · the new events in words.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_sponsor_d4387.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import SponsorSheet from '../src/pages/team/SponsorSheet.jsx';
import * as adapter from '../src/pages/team/agentsAdapter.js';
import { eventWords, pauseWords } from '../src/pages/team/teamModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const refusal = (status, code, message, extra = {}) => response({ ...extra, error: code, message, detail: message }, status);

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    seen.push({ key: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body: init.body ? JSON.parse(init.body) : null });
    return handle(String(u), init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const radio = (uid) => walk(byId(`agent-sponsor-option-${uid}`) || { childNodes: [] }).find((n) => props(n)?.type === 'radio');
  const fire = async (node, name, arg) => { assert.ok(node, 'no node'); await act(async () => { props(node)[name](arg); }); await settle(); };
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k], radioProp: (uid, k) => props(radio(uid))?.[k],
    click: (id) => fire(byId(id), 'onClick', { stopPropagation() {} }),
    change: (id, v) => fire(byId(id), 'onChange', { target: { value: v, checked: v } }),
    pick: (uid) => fire(radio(uid), 'onChange', { target: { value: uid } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const CANDIDATES = {
  sponsor: { uid: 'u-avery', name: '[Avery Stone]' },
  candidates: [
    { uid: 'u-avery', name: '[Avery Stone]', current: true, can_sponsor: false, code: null, reason: null },
    { uid: 'u-jordan', name: '[Jordan Reyes]', current: false, can_sponsor: true, code: null, reason: null },
    { uid: 'u-sam', name: '[Sam Okafor]', current: false, can_sponsor: false, code: 'sponsor_plan_required', reason: 'That person is not on a paid Founder plan. A sponsor pays for the agent’s runs, so they need one.' },
  ],
};

// ---------------------------------------------------------------- the cap pill

test('the cap pill reads the Worker\'s resumes_at; with none it says no day, and the model does no date math', () => {
  // Mutation checked: the PAUSE cap reading `a.paused_at` (a browser-side day) instead → the 1 Dec assert fails.
  assert.equal(pauseWords({ status: 'paused', paused_reason: 'cap', resumes_at: '2026-12-01' }).reason, 'Reached its monthly cap. Resumes 1 Dec.');
  assert.equal(pauseWords({ status: 'paused', paused_reason: 'cap', resumes_at: null }).reason, 'Reached its monthly cap');
  assert.deepEqual([pauseWords({ status: 'paused', paused_reason: 'cap' }).action, pauseWords({ status: 'paused', paused_reason: 'sponsor_left' }).action], ['cap', 'sponsor']);
  assert.equal(pauseWords({ status: 'paused', paused_reason: 'manual' }).action, undefined, 'Resume opens the profile, no dialog');
  const model = readFileSync('frontend/src/pages/team/teamModel.js', 'utf8');
  const cap = model.slice(model.indexOf('  cap: (a) => {'), model.indexOf('  sponsor_left:'));
  assert.doesNotMatch(cap, /new Date|getUTC|setUTC|Date\.now/, 'no resume day is worked out in the browser');
});

// ---------------------------------------------------------------- TM9b

test('TM9b: "Choose a new sponsor" and "Raise the cap" open the profile on their dialog', async () => {
  const opened = [];
  const agents = [
    { uid: 'a1', persona: { name: 'Orrin' }, status: 'paused', paused_reason: 'sponsor_left', sponsor: { uid: 'u-avery', name: '[Avery Stone]' }, month_spend: { available: false } },
    { uid: 'a2', persona: { name: 'Vesta' }, status: 'paused', paused_reason: 'cap', resumes_at: '2026-12-01', sponsor: { uid: 'u-avery', name: '[Avery Stone]' }, month_spend: { available: false } },
  ];
  const v = await mount(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents } }, kind: 'project', companyName: 'x', onOpen: (row, action) => opened.push([row.uid, action]) }), () => response({}));
  try {
    assert.match(v.text(), /Choose a new sponsor/);
    assert.match(v.text(), /Reached its monthly cap\. Resumes 1 Dec\./);
    await v.click('agent-fix-a1');
    await v.click('agent-fix-a2');
    assert.deepEqual(opened, [['a1', 'sponsor'], ['a2', 'cap']]);
  } finally { await v.close(); }
  // The page opens the profile on the sponsor dialog for that action.
  const page = readFileSync('frontend/src/pages/team/TeamAgentsPage.jsx', 'utf8');
  assert.match(page, /onOpen=\{\(row, action\) => setSheet\(\{ kind: 'profile', uid: row\.uid, edit: action \|\| null \}\)\}/);
  assert.match(page, /editSponsor=\{sheet\.edit === 'sponsor'\}/);
});

// ---------------------------------------------------------------- the dialog

test('Choose a new sponsor: only those who can are offered, a reason of 10 characters, and Save sends the PUT', async () => {
  // Mutations checked: the radio enabled for every candidate → the disabled assert fails;
  // the reason minimum dropped → the disabled Save assert fails; changeSponsor sending no sponsor_uid → the body assert fails.
  const saved = [];
  const v = await mount(h(SponsorSheet, { uid: 'a1', name: 'Orrin', onCancel() {}, onSaved: (a) => saved.push(a) }), (u, init) => {
    if ((init.method || 'GET') === 'GET') return response(CANDIDATES);
    return response({ agent: { uid: 'a1', sponsor: { uid: 'u-jordan', name: '[Jordan Reyes]' } } });
  });
  try {
    const text = v.text();
    assert.match(text, /\[Jordan Reyes\]/);
    assert.match(text, /Sponsors it now/);
    assert.match(text, /That person is not on a paid Founder plan\./, 'why not, in the Worker\'s words');
    assert.equal(v.radioProp('u-sam', 'disabled'), true);
    assert.equal(v.radioProp('u-avery', 'disabled'), true, 'the current sponsor is not offered');
    assert.equal(v.radioProp('u-jordan', 'disabled'), false);
    await v.pick('u-jordan');
    await v.change('agent-sponsor-reason', 'too short');
    assert.equal(v.prop('agent-sponsor-save', 'disabled'), true, 'nine characters are not a reason');
    await v.change('agent-sponsor-reason', 'Avery moves to the board.');
    assert.equal(v.prop('agent-sponsor-save', 'disabled'), false);
    await v.click('agent-sponsor-save');
    const put = v.seen.find((s) => s.key === 'PUT /api/teams/agents/a1/sponsor');
    assert.deepEqual(put.body, { sponsor_uid: 'u-jordan', reason: 'Avery moves to the board.' });
    assert.equal(saved.length, 1);
    assert.equal(v.seen[0].key, 'GET /api/teams/agents/a1/sponsors');
  } finally { await v.close(); }
});

test('Choose a new sponsor: a refusal in the Worker\'s words; an agent with tools saves only once they are ticked', async () => {
  const words = 'That person has no AI tokens left. A sponsor pays for the agent’s runs from their tokens.';
  const v = await mount(h(SponsorSheet, { uid: 'a1', name: 'Orrin', toolCount: 2, onCancel() {}, onSaved() { throw new Error('not saved'); } }), (u, init) => {
    if ((init.method || 'GET') === 'GET') return response(CANDIDATES);
    return refusal(422, 'sponsor_no_tokens', words);
  });
  try {
    await v.pick('u-jordan');
    await v.change('agent-sponsor-reason', 'Avery moves to the board.');
    assert.equal(v.prop('agent-sponsor-save', 'disabled'), true, 'the tools must be ticked first');
    assert.match(v.text(), /Drop its 2 read tools\./);
    await v.change('agent-sponsor-drop-tools', true);
    await v.click('agent-sponsor-save');
    assert.deepEqual(v.seen.find((s) => s.key === 'PUT /api/teams/agents/a1/sponsor').body, { sponsor_uid: 'u-jordan', reason: 'Avery moves to the board.', drop_tools: true });
    assert.match(v.text(), /no AI tokens left/);
    assert.doesNotMatch(v.text(), /sponsor_no_tokens/, 'the code never reaches the page');
  } finally { await v.close(); }
});

test('the adapter: every coded refusal is the Worker\'s sentence; no code is unreadable; off is off', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  try {
    for (const [status, code] of [[422, 'sponsor_not_member'], [409, 'same_sponsor'], [400, 'reason_required'], [503, 'sponsor_balance_unreadable'], [403, 'not_manager']]) {
      globalThis.fetch = async () => refusal(status, code, `Words for ${code}.`, code === 'sponsor_tools' ? { tools: 2 } : {});
      const out = await adapter.changeSponsor('a1', { sponsorUid: 'u-x', reason: 'a reason here' });
      assert.deepEqual([out.available, out.refused, out.code, out.reason], [false, true, code, `Words for ${code}.`], code);
    }
    globalThis.fetch = async () => refusal(422, 'sponsor_tools', 'Drop them.', { tools: 2 });
    assert.equal((await adapter.changeSponsor('a1', {})).tools, 2);
    globalThis.fetch = async () => response({ detail: 'Internal server error' }, 500);
    assert.deepEqual(await adapter.sponsorCandidates('a1'), { available: false, unreadable: true, reason: 'could not be read' });
    globalThis.fetch = async () => refusal(404, 'team_agents_off', 'off');
    assert.deepEqual(await adapter.sponsorCandidates('a1'), { available: false, reason: 'AI agents aren’t switched on yet.' });
  } finally { globalThis.fetch = previous; restore(); }
});

// ---------------------------------------------------------------- events

test('the new events in words: a sponsor change names the new sponsor; a resume says why', () => {
  // Mutation checked: EVENTS.sponsor_changed removed → "Changed by …" and the assert fails.
  const actor = { uid: 'u-avery', name: '[Avery Stone]' };
  assert.equal(eventWords({ kind: 'sponsor_changed', actor, detail: { from: actor, to: { uid: 'u-jordan', name: '[Jordan Reyes]' }, reason: 'x'.repeat(12) } }), 'Sponsor changed to [Jordan Reyes] by [Avery Stone]');
  assert.equal(eventWords({ kind: 'sponsor_changed', actor, detail: null }), 'Sponsor changed by [Avery Stone]');
  assert.equal(eventWords({ kind: 'resumed', actor: null, detail: { reason: 'cap_reset' } }), 'Resumed at the start of the month');
  assert.equal(eventWords({ kind: 'resumed', actor, detail: { reason: 'sponsor_changed' } }), 'Resumed with its new sponsor by [Avery Stone]');
  assert.equal(eventWords({ kind: 'resumed', actor, detail: null }), 'Resumed by [Avery Stone]');
  // The profile draws them in words, never the kind.
  const html = renderedText(renderToStaticMarkup(h('ul', null, h('li', null, eventWords({ kind: 'sponsor_changed', actor: null, detail: { to: { name: 'N' } } })))));
  assert.doesNotMatch(html, /sponsor_changed/);
});

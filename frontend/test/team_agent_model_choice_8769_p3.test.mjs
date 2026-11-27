// D8769 part 3 (#8769, `design/incoming/Team Agent and Model Choice Page.dc.html`) —
// the parts of the canvas left after part 2, built to the owner's option A.
//
//   · TMM04B, Q2 = A: the wizard's Skills step holds Next until a skill is
//     chosen. Next stays focusable (aria-disabled) and is described by
//     "{name} can’t run without a skill. Choose at least one to continue.";
//     a skills read that failed holds it too, with Try again; only skills not
//     open at all let it go on with none;
//   · TMM07 A and B: a manager's ⋯ menu is the canvas's whole list, each item
//     opening the profile on that action; a no-skills row carries "Add skills
//     for {name}"; a reader sees only the profile;
//   · Q4 = A: the profile's skills say what each one makes ("Makes a brief").
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_agent_model_choice_8769_p3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import AddAgentSheet from '../src/pages/team/AddAgentSheet.jsx';
import { AgentSkillsView } from '../src/pages/team/AgentSkillsCard.jsx';
import { actionItems, addSkillsLabel, makesLine, skillsGate } from '../src/pages/team/agentChoiceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const render = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    seen.push(`${(init.method || 'GET').toUpperCase()} ${url.pathname}`);
    return handle(url, init) ?? json({});
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await tick(); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (node, name, arg) => { assert.ok(node, 'no node'); await act(async () => { props(node)[name](arg); }); await settle(); };
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k], textOf: (id) => (byId(id) ? textOf(byId(id)) : null),
    click: (id) => fire(byId(id), 'onClick', { stopPropagation() {}, preventDefault() {} }),
    change: (id) => fire(byId(id), 'onChange', { target: { checked: true } }),
    byId,
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const persona = (key, name, fit = ['finance']) => ({ key, name, tagline: `[${name}'s motto]`, natural_fit: fit, top_values: ['integrity'], risk: 3, story: `${name}'s story.`, goal: `${name}'s goal.`, values: {} });
const AGENT = (uid, over = {}) => ({
  uid, role_key: 'coo', persona: persona('tessaly', 'Tessaly'), model_id: 'm-a', model_label: '[Model A]',
  tools: [], sponsor: { uid: 'u1', name: '[Maya Ruiz]' }, status: 'active', paused_reason: null, monthly_cap_microusd: 25_000_000,
  month_spend: { available: true, value_microusd: 3_840_000 }, last_activity_at: null, project: null, skill_count: 3, ...over,
});

// ---------------------------------------------------------------- TMM07 B: the ⋯ menu

test('a manager\'s ⋯ menu is the canvas\'s list; a reader\'s is the profile only; the fix is never repeated', () => {
  // Mutations checked: canManage ignored → the reader's list grows and fails; the dedupe dropped → "Edit Vesta's cap" follows
  // "Raise the cap" and fails; Pause offered to a paused agent → the paused rows fail; an outside assistant offered skills,
  // cap and sponsor → its list fails; Resume offered for a pause Resume cannot lift (ai_paused) → that row fails.
  const pairs = (row, m) => actionItems(row, m).map((i) => [i.label, i.action ?? null]);
  const active = { name: 'Tessaly', pause: null };
  assert.deepEqual(pairs(active, false), [['Open Tessaly’s profile', null]]);
  assert.deepEqual(pairs(active, true), [
    ['Open Tessaly’s profile', null], ['Add skills for Tessaly', 'skills'], ['Edit Tessaly’s cap', 'cap'], ['Change Tessaly’s sponsor', 'sponsor'], ['Pause Tessaly', 'pause'],
  ], 'TMM07 B, in its order');
  assert.deepEqual(pairs({ name: 'Vesta', pause: { fix: 'Raise the cap', action: 'cap' } }, true),
    [['Open Vesta’s profile', null], ['Raise the cap', 'cap'], ['Add skills for Vesta', 'skills'], ['Change Vesta’s sponsor', 'sponsor']]);
  assert.deepEqual(pairs({ name: 'Orrin', pause: { fix: 'Resume' } }, true).slice(-1), [['Resume Orrin', 'pause']]);
  assert.equal(pairs({ name: 'Orrin', pause: { fix: null } }, true).some(([l]) => /Resume|Pause/.test(l)), false, 'no Resume where none is possible');
  assert.deepEqual(pairs({ name: '[Iris]', outside: true, pause: null }, true), [['Open [Iris]’s profile', null], ['Pause [Iris]', 'pause']]);
  assert.equal(addSkillsLabel('Kade'), 'Add skills for Kade');
});

test('the roster: a no-skills row carries "Add skills for {name}" for a manager, and every menu item opens the profile on its action', async () => {
  // Mutations checked: the fix drawn for a reader → the reader's has() fails; the fix opening the profile with no action → the
  // opened list fails; pick() ignoring the item's action → the menu entries open with null and fail.
  const kade = AGENT('a3', { role_key: 'cmo', persona: persona('kade', 'Kade', ['marketing']), skill_count: 0 });
  const tess = AGENT('a1');
  const html = render(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: [tess, kade] } }, kind: 'project', companyName: 'x' }));
  const row = html.slice(html.indexOf('data-testid="agent-a3"')).split('role="row"')[0];
  assert.match(renderedText(row), /No skills yetCan’t run until a skill is addedAdd skills for Kade/);
  assert.doesNotMatch(html.slice(html.indexOf('data-testid="agent-a1"')).split('role="row"')[0], /agent-add-skills/, 'only the no-skills row');
  const reader = render(h(AgentsCard, { block: { available: true, value: { can_manage: false, agents: [kade] } }, kind: 'project', companyName: 'x' }));
  assert.doesNotMatch(reader, /agent-add-skills-a3/);
  assert.match(renderedText(reader), /Can’t run until a skill is added/);

  const opened = [];
  const v = await mount(h(AgentsCard, { block: { available: true, value: { can_manage: true, agents: [tess, kade] } }, kind: 'project', companyName: 'x', onOpen: (r, a) => opened.push([r.uid, a ?? null]) }), () => json({}));
  try {
    await v.click('agent-add-skills-a3');
    await v.click('agent-menu-a1');
    assert.equal(v.textOf('agent-menu-a1-items'), 'Open Tessaly’s profileAdd skills for TessalyEdit Tessaly’s capChange Tessaly’s sponsorPause Tessaly');
    for (const key of ['skills', 'cap', 'sponsor', 'pause']) {
      if (!v.has('agent-menu-a1-items')) await v.click('agent-menu-a1');
      await v.click(`agent-menu-a1-${key}`);
    }
    assert.deepEqual(opened, [['a3', 'skills'], ['a1', 'skills'], ['a1', 'cap'], ['a1', 'sponsor'], ['a1', 'pause']]);
  } finally { await v.close(); }
});

test('the page opens the profile on the menu\'s action: Pause confirms, Add skills opens for a manager once read', () => {
  // Source pins: the page maps each action to the profile's prop, the profile opens its confirm or hands Add skills down,
  // and the skills card opens Add skills only for a manager (mutation: `&& manage` dropped → the last match fails).
  assert.match(read('frontend/src/pages/team/TeamAgentsPage.jsx'), /editPause=\{sheet\.edit === 'pause'\} addSkills=\{sheet\.edit === 'skills'\}/);
  const profile = read('frontend/src/pages/team/AgentProfileSheet.jsx');
  assert.match(profile, /useState\(editCap \? 'cap' : editSponsor \? 'sponsor' : editPause \? 'pause' : null\)/);
  assert.match(profile, /openAdd=\{addSkills\}/);
  const card = read('frontend/src/pages/team/AgentSkillsCard.jsx');
  assert.match(card, /useState\(!!openAdd\)/);
  assert.match(card, /\{adding && value && manage \? <AddSkillsSheet/);
});

// ---------------------------------------------------------------- Q4 = A: what each skill makes

test('the profile\'s skills say what each makes; a skill whose output was not read says nothing', () => {
  // Mutations checked: makesLine keeping the capital ("Makes A brief") → the equal fails; `makes` not passed to SkillRow →
  // the rendered line fails; a missing label drawn as "Makes " → the second doesNotMatch fails.
  assert.equal(makesLine({ output_label: 'A brief' }), 'Makes a brief');
  assert.equal(makesLine({ output_label: 'A record change' }), 'Makes a record change');
  assert.equal(makesLine({ output_kind: 'brief' }), null, 'no label, no guess');
  assert.equal(makesLine(null), null);
  const html = render(h(AgentSkillsView, {
    agent: { uid: 'a1' }, canManage: false, busy: false,
    value: { skills: [{ uid: 's1', name: 'Research brief', pinned_version: 2, current_version: 2, status: 'published', tools: [], output_kind: 'brief', output_label: 'A brief' },
      { uid: 's2', name: 'Old skill', pinned_version: 1, current_version: 1, status: 'published', tools: [] }], radar: null, values: null },
  }));
  const one = html.slice(html.indexOf('data-testid="skill-row-s1"'), html.indexOf('data-testid="skill-row-s2"'));
  assert.match(one, /data-testid="skill-makes">Makes a brief</);
  assert.doesNotMatch(html.slice(html.indexOf('data-testid="skill-row-s2"')), /skill-makes|Makes /);
});

// ---------------------------------------------------------------- TMM04B, Q2 = A: the skills gate

test('skillsGate: off while reading, off with none chosen, off when the read failed, on with one; skills not open go on', () => {
  // Mutations checked: available-with-none returning ok → the first off assert fails; unreadable returning ok → the
  // failed-read assert fails; the not-open branch returning off → the last assert fails.
  assert.deepEqual(skillsGate(null, 0, 'Ryssa'), { ok: false, why: 'Reading the skills Ryssa could take…' });
  assert.deepEqual(skillsGate({ available: true, value: { skills: [] } }, 0, 'Ryssa'), { ok: false, why: 'Ryssa can’t run without a skill. Choose at least one to continue.' });
  assert.deepEqual(skillsGate({ available: true }, 1, 'Ryssa'), { ok: true, why: null });
  assert.equal(skillsGate({ available: false, unreadable: true }, 0, 'Ryssa').ok, false);
  assert.match(skillsGate({ available: false, unreadable: true }, 0, 'Ryssa').why, /could not be read, so Next stays off/);
  assert.deepEqual(skillsGate({ available: false, reason: 'off' }, 0, 'Ryssa'), { ok: true, why: null }, 'skills not open at all: nothing could be chosen');
  assert.match(skillsGate({ available: true }, 0, '').why, /^The agent can’t run/);
});

const SKILL = (uid, fit) => ({ uid, name: `[Skill ${uid}]`, version: 1, status: 'published', tools: [], eligibility: { state: 'eligible', fit } });
function wizard(eligible) {
  let reads = 0;
  const handle = (u) => {
    if (u.pathname.endsWith('/personas')) return json({ personas: [persona('ryssa', 'Ryssa', ['product'])], values: [], areas: [] });
    if (u.pathname.endsWith('/tools')) return json({ servers: [] });
    if (u.pathname.endsWith('/skills/eligible')) { reads += 1; return eligible(reads); }
    return json({});
  };
  return { handle, reads: () => reads };
}
const SHEET = { scope: { kind: 'project', project: { id: 7, name: '[Atlas Orchard]' } }, roles: [{ key: 'research_analyst', default_rules: {} }], models: [], onClose() {} };

test('the wizard holds Next on Skills until a skill is chosen: focusable, aria-disabled, described by why', async () => {
  // Mutations checked: `ready` for step 1 left as true → the press reaches Model and cap and fails; `disabled` kept on
  // step 1 → the not-disabled assert fails; aria-describedby dropped → its assert fails.
  const w = wizard(() => json({ skills: [SKILL('k1', false)], areas: [] }));
  const m = await mount(h(AddAgentSheet, SHEET), w.handle);
  try {
    await m.click('agent-pick-ryssa');
    await m.click('add-agent-next');
    assert.match(m.text(), /Step 2 of 3 · Choose skills for Ryssa/);
    assert.equal(m.prop('add-agent-next', 'disabled'), false, 'focusable');
    assert.equal(m.prop('add-agent-next', 'aria-disabled'), true);
    assert.equal(m.prop('add-agent-next', 'aria-describedby'), 'add-agent-skills-gate');
    assert.equal(m.textOf('add-agent-skills-gate'), 'Ryssa can’t run without a skill. Choose at least one to continue.');
    assert.equal(m.prop('add-agent-skills-gate', 'role'), 'status');
    assert.equal(m.textOf('add-agent-next'), 'Next: model and cap', 'never "with no skills" while it is held');
    await m.click('add-agent-next');
    assert.match(m.text(), /Step 2 of 3/, 'a press does nothing while held');
    const box = m.byId('add-agent-skill-k1') ? 'add-agent-skill-k1' : null;
    assert.ok(box, 'the skill can be ticked');
    const props = Object.entries(m.byId(box)).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { (props.onChange || props.onClick)({ target: { checked: true }, stopPropagation() {}, preventDefault() {} }); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await tick(); });
    assert.equal(m.prop('add-agent-next', 'aria-disabled'), undefined);
    assert.equal(m.has('add-agent-skills-gate'), false);
    await m.click('add-agent-next');
    assert.match(m.text(), /Step 3 of 3 · Model and cap for Ryssa/);
  } finally { await m.close(); }
});

test('a skills read that failed holds Next and offers Try again, which reads again; skills not open go on with none', async () => {
  // Mutations checked: the retry not re-running the read (tries left out of the effect's deps) → reads stays 1 and fails;
  // the unreadable branch ok → the aria-disabled assert fails; the not-open branch held → the last step assert fails.
  const w = wizard((n) => (n === 1 ? json({ error: 'boom' }, 500) : json({ skills: [SKILL('k1', true)], areas: [] })));
  const m = await mount(h(AddAgentSheet, SHEET), w.handle);
  try {
    await m.click('agent-pick-ryssa');
    await m.click('add-agent-next');
    assert.equal(m.prop('add-agent-skills-unreadable', 'role'), 'alert');
    assert.match(m.textOf('add-agent-skills-unreadable'), /could not be read\. That is not the same as having none\./);
    assert.equal(m.prop('add-agent-next', 'aria-disabled'), true);
    assert.match(m.textOf('add-agent-skills-gate'), /could not be read, so Next stays off/);
    await m.click('add-agent-skills-retry');
    assert.equal(w.reads(), 2);
    assert.equal(m.prop('add-agent-next', 'aria-disabled'), undefined, 'the natural-fit skill is picked for it once read');
  } finally { await m.close(); }
  const off = wizard(() => json({ error: 'team_agents_off' }, 404));
  const o = await mount(h(AddAgentSheet, SHEET), off.handle);
  try {
    await o.click('agent-pick-ryssa');
    await o.click('add-agent-next');
    assert.equal(o.textOf('add-agent-next'), 'Next: model and cap, with no skills');
    await o.click('add-agent-next');
    assert.match(o.text(), /Step 3 of 3/);
  } finally { await o.close(); }
});

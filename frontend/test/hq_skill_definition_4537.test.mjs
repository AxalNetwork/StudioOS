// D4537 (#4537, step 2): HQ › AI agents › From Axal › a skill › Definition. The working draft is edited through the
// existing PATCH /api/teams/skills/:uid; the Worker's checkDraft decides, and its code marks the field it is about.
//
// What is held:
//   - the form round-trips a skill to the PATCH body in the Worker's words (tags back to level names, tools split);
//   - every checkDraft code has a field and a sentence, and a code it does not know shows the Worker's sentence;
//   - the slug is shown and never sent; a retired skill is read only; saving says what it does to review and evals;
//   - a refused save is shown as not saved, with its code, and never as saved.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_skill_definition_4537.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';
import { DefinitionEditor } from '../src/pages/hq/aiAgents/DefinitionEditor.jsx';
import {
  DEFINITION_REFUSALS, definitionDirty, definitionEditable, definitionForm, definitionPatch, definitionRefusal, levelKey, levelRank, saveConsequence,
} from '../src/pages/hq/aiAgents/definitionModel.js';

const h = React.createElement;
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const settle = async (ui) => { await ui.flush(); await ui.flush(); };
const press = async (ui, id) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); assert.ok(!ui.props(n).disabled, `${id} is disabled`); await act(async () => ui.props(n).onClick()); await settle(ui); };
function stub(obj, fns) { const old = {}; for (const k of Object.keys(fns)) { old[k] = obj[k]; obj[k] = fns[k]; } return () => { for (const k of Object.keys(old)) obj[k] = old[k]; }; }

const SKILL = {
  uid: 's1', slug: 'cash-runway-snapshot', name: 'Cash runway snapshot', purpose: 'Runway from recorded balances.', status: 'draft',
  steps: ['Read balances', 'Compute burn'], tools: ['mercury.read', 'stripe.read'], output_kind: 'brief',
  tags: [{ slug: 'finance_cash', level: 'proficient' }, { slug: 'investor_reporting', level: 'working' }], roles: ['cfo'],
};
const TAX = { categories: [{ slug: 'finance_ops', label: 'Finance', skills: [{ slug: 'finance_cash', label: 'Cash' }, { slug: 'investor_reporting', label: 'Investor reporting' }] }] };
const ROLES = { roles: [{ key: 'cfo', name: 'CFO' }, { key: 'ceo', name: 'CEO' }] };

test('the form round-trips a skill to the PATCH body in the Worker\'s words', () => {
  assert.deepEqual([levelKey(3), levelRank('Proficient'), levelRank('nope')], ['proficient', 3, 0]);
  const form = definitionForm(SKILL, (s) => (s === 'finance_cash' ? 'Cash' : null));
  assert.equal(form.tools, 'mercury.read\nstripe.read');
  assert.deepEqual(form.tags.map((t) => [t.skill_slug, t.skill_label, t.level]), [['finance_cash', 'Cash', 3], ['investor_reporting', 'investor_reporting', 2]]);
  const body = definitionPatch(form);
  assert.deepEqual(body, { name: SKILL.name, purpose: SKILL.purpose, steps: SKILL.steps, tools: SKILL.tools, output_kind: 'brief', tags: SKILL.tags, roles: ['cfo'] });
  assert.ok(!('slug' in body), 'the slug is never sent');
  assert.equal(definitionDirty(form, SKILL), false);
  assert.equal(definitionDirty({ ...form, tools: 'mercury.read, stripe.read, github.read' }, SKILL), true);
  assert.deepEqual(definitionPatch({ ...form, tools: ' a.read ,\n\nb.read ' }).tools, ['a.read', 'b.read']);
  assert.deepEqual(definitionForm({}).steps, [''], 'an empty skill still offers one step to fill');
});

test('every checkDraft code has a field and a sentence; an unknown code shows the Worker\'s sentence', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/agents/skills.ts', import.meta.url), 'utf8');
  const codes = [...src.matchAll(/no\('([a-z_]+)'\)/g)].map((m) => m[1]).concat('tool_not_read_only');
  for (const c of new Set(codes)) assert.ok(DEFINITION_REFUSALS[c], `no words for ${c}`);
  assert.deepEqual(definitionRefusal('roles_missing'), { code: 'roles_missing', field: 'roles', text: 'Choose at least one agent role.' });
  assert.match(definitionRefusal('tool_not_read_only', { tool: 'gmail.send' }).text, /gmail\.send can change records/);
  assert.deepEqual(definitionRefusal('something_new', null, 'The Worker said so.'), { code: 'something_new', field: null, text: 'The Worker said so.' });
  assert.equal(definitionRefusal(null).text, 'That change was not saved.');
});

test('a retired skill is read only, and saving says what it does to the review and evaluation', () => {
  assert.deepEqual(['draft', 'in_review', 'published', 'retired'].map(definitionEditable), [true, true, true, false]);
  assert.match(saveConsequence('in_review'), /open review and its evaluation no longer cover it/);
  assert.match(saveConsequence('published'), /published version stays as it is/);
});

test('the editor saves the draft through PATCH, and a refusal marks its field and says not saved', async () => {
  const calls = [];
  let refuse = { status: 400, data: { error: 'roles_missing', message: 'A skill belongs to at least one agent role.' } };
  const restore = [
    stub(api.skills, { getTaxonomy: async () => TAX }),
    stub(teamAgentsApi, { roles: async () => ROLES, updateSkill: async (uid, body) => { calls.push([uid, body]); if (refuse) throw Object.assign(new Error('RAW socket hang up'), refuse); return { skill: {} }; } }),
  ];
  let saved = 0;
  const ui = await mountContracts(h(DefinitionEditor, { skill: SKILL, onSaved: () => { saved += 1; } }));
  try {
    await settle(ui);
    await press(ui, 'def-open');
    assert.equal(txt(find(ui, 'hq-skill-slug')[0]), 'cash-runway-snapshot');
    assert.equal(ui.props(find(ui, 'def-save')[0]).disabled, true, 'nothing changed, nothing to save');
    await act(async () => ui.props(find(ui, 'def-role-cfo')[0]).onChange());
    await press(ui, 'def-save');
    assert.deepEqual(calls[0][1].roles, []);
    assert.equal(saved, 0, 'a refused save is not saved');
    assert.match(txt(find(ui, 'def-refused')[0]), /Not saved\. Choose at least one agent role\. roles_missing/);
    assert.doesNotMatch(ui.text(), /socket hang up/);
    // Mutation checked: dropping `bad('roles')` from the roles fieldset → it is not marked and this fails.
    assert.match(ui.props(find(ui, 'def-roles')[0]).className, /border-red-500/);
    refuse = null;
    await act(async () => ui.props(find(ui, 'def-role-ceo')[0]).onChange());
    await press(ui, 'def-save');
    assert.deepEqual(calls[1], ['s1', { ...definitionPatch(definitionForm(SKILL)), roles: ['ceo'] }]);
    assert.equal(saved, 1);
    assert.equal(find(ui, 'def-refused').length, 0);
  } finally { await ui.unmount(); restore.forEach((r) => r()); }
});

test('a retired skill draws no form; failed option reads say so instead of an empty list', async () => {
  const restore = [stub(api.skills, { getTaxonomy: async () => { throw new Error('x'); } }), stub(teamAgentsApi, { roles: async () => { throw new Error('x'); } })];
  const ro = await mountContracts(h(DefinitionEditor, { skill: { ...SKILL, status: 'retired' } }));
  try { await settle(ro); assert.equal(find(ro, 'def-open').length, 0); assert.match(ro.text(), /A retired skill is read only/); } finally { await ro.unmount(); }
  const ui = await mountContracts(h(DefinitionEditor, { skill: SKILL }));
  try {
    await settle(ui); await press(ui, 'def-open');
    assert.match(ui.text(), /The roles could not be read/);
    assert.match(ui.text(), /could not be read/);
  } finally { await ui.unmount(); restore.forEach((r) => r()); }
});

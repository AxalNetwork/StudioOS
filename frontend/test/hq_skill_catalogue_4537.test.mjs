// D4537 (#4537, first step): HQ › AI agents › Skills library › From Axal. The catalogue filters (status, area, role,
// evaluation state, source) and the line between a source-library file, a stored draft and a published skill.
//
// What is held:
//   - each filter is exact, and they combine;
//   - a missing evaluation is never a pass: no cases, not evaluated and partly evaluated are their own states;
//   - a source-library file not in the store is listed apart, with its check and "Not seeded", and is never a skill row;
//   - an unreadable source library never hides the stored skills, and the source is "Not recorded" until it reads.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_skill_catalogue_4537.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { adminHqSkillsApi } from '../src/lib/api/adminHqSkills.js';
import { FromAxal } from '../src/pages/hq/aiAgents/HqAiAgentsPage.jsx';
import { NOT_RECORDED, evalState, filterSkills, roleOptions, skillRow, sourceOnlyRows, SKILL_FILTERS } from '../src/pages/hq/aiAgents/aiAgentsModel.js';

const h = React.createElement;
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const pick = async (ui, id, value) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); await act(async () => ui.props(n).onChange({ target: { value } })); };
const settle = async (ui) => { await ui.flush(); await ui.flush(); };
function stub(obj, fns) {
  const old = {}; for (const k of Object.keys(fns)) { old[k] = obj[k]; obj[k] = fns[k]; }
  return () => { for (const k of Object.keys(old)) obj[k] = old[k]; };
}

const golden = (pass, total, notEvaluated, meets) => ({ pass, total, not_evaluated: notEvaluated, meets_bar: meets });
const CFO = { key: 'cfo', label: 'CFO' }, CTO = { key: 'cto', label: 'CTO' };
const CARDS = [
  { uid: 's1', slug: 'cash-runway-snapshot', name: 'Cash runway snapshot', area: { slug: 'finance_ops' }, level: 'proficient', status: 'published', version: 2, agents: 3, roles: [CFO], tools: ['mercury.read'], golden: golden(10, 10, 0, true), last_eval: '2026-11-08' },
  { uid: 's2', slug: 'own-draft', name: 'Own draft', area: { slug: 'engineering' }, level: 'working', status: 'draft', version: null, agents: 0, roles: [CTO], tools: [], golden: golden(0, 0, 0, false), last_eval: null },
  { uid: 's3', slug: 'board-brief', name: 'Board brief', area: { slug: 'finance_ops' }, level: 'advanced', status: 'in_review', version: 1, agents: 1, roles: [CFO, CTO], tools: ['compliance.read'], golden: golden(4, 10, 4, false), last_eval: '2026-11-07' },
  { uid: 's4', slug: 'old-one', name: 'Old one', area: null, level: null, status: 'retired', version: 1, agents: 0, roles: [], tools: [], golden: golden(0, 2, 2, false), last_eval: null },
];
const LIBRARY = [
  { slug: 'cash-runway-snapshot', name: 'Cash runway snapshot', area: 'finance_ops', level: 'proficient', cases: 3, check: { ok: true }, in_store: 'published' },
  { slug: 'board-brief', name: 'Board brief', area: 'finance_ops', level: 'advanced', cases: 2, check: { ok: true }, in_store: 'draft' },
  { slug: 'deal-memo', name: 'Deal memo', area: 'capital_network', level: 'working', cases: 2, check: { ok: true }, in_store: null },
  { slug: 'bad-file', name: 'Bad file', area: null, level: null, cases: 0, check: { ok: false, code: 'unknown_role', message: 'The role "cmo" is not a catalogue role.' }, in_store: null },
];
const rowsOf = (lib = new Set(LIBRARY.map((x) => x.slug))) => CARDS.map((c) => skillRow(c, lib));

test('a missing evaluation is never a pass: each state is its own', () => {
  assert.equal(evalState(golden(0, 0, 0, false)), 'no_cases');
  assert.equal(evalState(golden(0, 4, 4, false)), 'not_evaluated');
  // Mutation checked: reading `partial` as `below_bar` (dropping the missing > 0 branch) fails here.
  assert.equal(evalState(golden(2, 4, 1, false)), 'partial');
  assert.equal(evalState(golden(2, 4, 0, false)), 'below_bar');
  assert.equal(evalState(golden(9, 10, 0, true)), 'meets_bar');
  assert.equal(evalState(golden(9, 10, 0, false)), 'below_bar', 'the server\'s bar decides, not the client');
  assert.equal(evalState(null), null);
  assert.equal(evalState({ pass: 1, total: 2 }), null, 'an older row with no not_evaluated is unknown, never a pass');
});

test('each filter is exact, and they combine', () => {
  const rows = rowsOf();
  const uids = (f) => filterSkills(rows, { ...SKILL_FILTERS, ...f }).map((r) => r.uid);
  assert.deepEqual(uids({}), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(uids({ status: 'in_review' }), ['s3']);
  assert.deepEqual(uids({ area: 'finance_ops' }), ['s1', 's3']);
  assert.deepEqual(uids({ role: 'cto' }), ['s2', 's3']);
  assert.deepEqual(uids({ evals: 'no_cases' }), ['s2']);
  assert.deepEqual(uids({ evals: 'not_evaluated' }), ['s4']);
  assert.deepEqual(uids({ source: 'library' }), ['s1', 's3']);
  assert.deepEqual(uids({ source: 'authored' }), ['s2', 's4']);
  assert.deepEqual(uids({ q: 'BOARD' }), ['s3']);
  assert.deepEqual(uids({ q: 'own-draft' }), ['s2'], 'the slug is searched too');
  assert.deepEqual(uids({ area: 'finance_ops', role: 'cto' }), ['s3']);
  assert.deepEqual(uids({ status: 'published', evals: 'partial' }), []);
  assert.deepEqual(roleOptions(rows), [CFO, CTO]);
});

test('the source is unknown until the library reads; then library or authored', () => {
  assert.equal(skillRow(CARDS[0]).source, null);
  assert.equal(skillRow(CARDS[0], new Set(['cash-runway-snapshot'])).source, 'library');
  assert.equal(skillRow(CARDS[1], new Set(['cash-runway-snapshot'])).source, 'authored');
});

test('library files not in the store are definitions: their check and their seed state, nothing else', () => {
  const rows = sourceOnlyRows(LIBRARY);
  assert.deepEqual(rows.map((r) => r.slug), ['deal-memo', 'bad-file']);
  assert.deepEqual(rows[1].check, { ok: false, code: 'unknown_role', line: 'The role "cmo" is not a catalogue role.' });
  assert.equal(rows[1].area, NOT_RECORDED);
  for (const r of rows) assert.ok(!('status' in r) && !('version' in r) && !('agents' in r), 'a file has no status, version or agents');
});

test('the list filters on screen, says how many match, and lists unseeded files apart', async () => {
  const restore = stub(adminHqSkillsApi, { library: async () => ({ skills: LIBRARY }) });
  const ui = await mountContracts(h(FromAxal, { skills: { status: 'ready', hq: CARDS }, onRetry() {} }), '/hq/ai-agents/skills');
  try {
    await settle(ui);
    assert.equal(find(ui, 'ai-agents-skill-row').length, 4);
    assert.deepEqual(find(ui, 'ai-agents-skill-source').map(txt), ['From a library file', 'Authored in HQ', 'From a library file', 'Authored in HQ']);
    await pick(ui, 'skill-filter-role', 'cto');
    await pick(ui, 'skill-filter-area', 'finance_ops');
    assert.equal(find(ui, 'ai-agents-skill-row').length, 1);
    assert.equal(txt(find(ui, 'skill-filter-count')[0]), '1 of 4 skills');
    await pick(ui, 'skill-filter-evals', 'meets_bar');
    assert.match(txt(find(ui, 'ai-agents-skill-empty')[0]), /No skill matches these filters\./);
    await act(async () => ui.props(find(ui, 'skill-filter-clear')[0]).onClick());
    assert.equal(find(ui, 'ai-agents-skill-row').length, 4);
    // The unseeded files are their own table, each "Not seeded", with the invalid one's code.
    const files = find(ui, 'ai-agents-source-only-row');
    assert.equal(files.length, 2);
    assert.match(txt(files[1]), /unknown_role/);
    assert.ok(files.every((n) => /Not seeded/.test(txt(n))));
    // Every select is labelled.
    for (const id of ['skill-filter-status', 'skill-filter-area', 'skill-filter-role', 'skill-filter-evals', 'skill-filter-source']) {
      assert.ok(ui.props(find(ui, id)[0])['aria-label'], `${id} has no label`);
    }
  } finally { await ui.unmount(); restore(); }
});

test('an unreadable source library never hides the stored skills; the source reads "Not recorded"', async () => {
  const restore = stub(adminHqSkillsApi, { library: async () => { throw new Error('RAW socket hang up'); } });
  const ui = await mountContracts(h(FromAxal, { skills: { status: 'ready', hq: CARDS }, onRetry() {} }), '/hq/ai-agents/skills');
  try {
    await settle(ui);
    assert.equal(find(ui, 'ai-agents-skill-row').length, 4);
    assert.ok(find(ui, 'ai-agents-skill-source').every((n) => txt(n) === NOT_RECORDED));
    assert.equal(ui.props(find(ui, 'skill-filter-source')[0]).disabled, true, 'no source filter without the library');
    assert.match(ui.text(), /The source library could not be read just now/);
    assert.doesNotMatch(ui.text(), /socket hang up/);
  } finally { await ui.unmount(); restore(); }
});

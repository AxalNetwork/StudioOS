/** #4705: mounted studio Pipeline keyboard entry, form recovery and measured synthetic read counts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PipelinePage from '../src/pages/PipelinePage.jsx';

const text = n => n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join('');
const deal = id => ({ id, name: `Startup ${id}`, sector: 'saas', pipeline_stage: 'idea', task_counts: { todo: 0, in_progress: 0, done: 0 } });
async function board(size = 1, answers = {}) {
  const saved = { ...api }, calls = [];
  const methods = {
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    pipelineActive: async () => Array.from({ length: size }, (_, i) => deal(i + 1)),
    getVotes: async () => ({ total_voters: 0, total_weight: 0, by_type: {}, strong_buy_pct: 0 }),
    pipelineDealDetail: async id => ({ id, current_stage: 'idea', project: { name: `Startup ${id}` }, tasks: [], metrics: [], gates: [], stages: [] }),
    ...answers,
  };
  for (const [k, fn] of Object.entries(methods)) api[k] = (...args) => { calls.push([k, args]); return fn(...args); };
  const m = await mountContracts(React.createElement(PipelinePage, { embedded: true }));
  await m.flush();
  return { ...m, calls, field: label => {
    const parent = m.nodes().find(n => n.tagName === 'LABEL' && text(n).trim().startsWith(label));
    return parent?.childNodes.find(n => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
  }, close: async () => { await m.unmount(); Object.assign(api, saved); } };
}

test('a startup has a native keyboard-open button and retains its non-drag stage actions', async () => {
  const m = await board();
  try {
    const open = m.nodes().find(n => n.tagName === 'BUTTON' && m.props(n)?.['aria-label'] === 'Open Startup 1');
    assert.ok(open, 'native button gives Enter/Space behavior without a clickable-div key shim');
    await act(async () => m.props(open).onClick({ stopPropagation() {} }));
    await m.flush();
    assert.ok(m.nodes().some(n => m.props(n)?.role === 'dialog'));
    assert.match(m.text(), /Advance to Stage:/);
    assert.ok(m.nodes().some(n => n.tagName === 'BUTTON' && text(n) === 'MVP Dev'), 'keyboard/touch stage path stays available');
  } finally { await m.close(); }
});

test('failed startup creation uses a named shared dialog, associated labels and preserves every entry', async () => {
  const m = await board(1, { pipelineCreateProject: async () => { throw new Error('private-raw-server-detail'); } });
  const values = { 'Name *': 'Keep startup', Sector: 'health', Description: 'Description draft', Problem: 'Problem draft', Solution: 'Solution draft' };
  try {
    await m.click('New Pipeline Startup');
    const dialog = m.nodes().find(n => m.props(n)?.role === 'dialog');
    assert.ok(dialog, 'creation uses the shared Sheet dialog');
    assert.equal(m.props(dialog)['aria-modal'], 'true');
    assert.ok(m.props(dialog)['aria-labelledby'], 'dialog has a title');
    for (const [label, value] of Object.entries(values)) {
      assert.ok(m.field(label), `${label} wraps its control`);
      await m.fill(label, value);
    }
    await m.click('Create');
    await m.flush();
    assert.doesNotMatch(m.text(), /private-raw-server-detail/);
    assert.ok(m.nodes().some(n => m.props(n)?.role === 'alert' && text(n).includes('The startup could not be created.')));
    for (const [label, value] of Object.entries(values)) assert.equal(m.props(m.field(label)).value, value);
    assert.deepEqual(m.calls.find(([k]) => k === 'pipelineCreateProject')[1][0], { name: values['Name *'], sector: values.Sector, description: values.Description, problem_statement: values.Problem, solution: values.Solution });
  } finally { await m.close(); }
});

test('a failed vote shows fixed copy and keeps its comment and anonymity selection', async () => {
  const m = await board(1, { castVote: async () => { throw new Error('private-vote-detail'); } });
  try {
    await m.click('Add comment / anonymous');
    const comment = m.nodes().find(n => m.props(n)?.placeholder === 'Optional comment (sent with next vote)');
    assert.equal(m.props(comment)['aria-label'], 'Vote comment');
    await act(async () => m.props(comment).onChange({ target: { value: 'Keep my comment' } }));
    const anon = m.nodes().find(n => m.props(n)?.type === 'checkbox');
    await act(async () => m.props(anon).onChange({ target: { checked: true } }));
    await m.click('B');
    await m.flush();
    assert.doesNotMatch(m.text(), /private-vote-detail/);
    assert.match(m.text(), /Your vote could not be recorded/);
    assert.equal(m.props(comment).value, 'Keep my comment');
    assert.equal(m.props(anon).checked, true);
  } finally { await m.close(); }
});

for (const size of [1, 20]) test(`local synthetic read baseline for ${size} startup cards`, async t => {
  const m = await board(size);
  try {
    const count = name => m.calls.filter(([k]) => k === name).length;
    const observed = { cards: size, boardReads: count('pipelineActive'), accountReads: count('getCurrentUser'), voteReads: count('getVotes'), detailReads: count('pipelineDealDetail') };
    t.diagnostic(JSON.stringify(observed));
    assert.equal(observed.boardReads, 1);
    assert.equal(observed.accountReads, 1);
    assert.equal(observed.voteReads, size);
    assert.equal(observed.detailReads, 0);
  } finally { await m.close(); }
});

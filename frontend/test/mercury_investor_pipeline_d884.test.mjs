/**
 * D884 (#2557) — "From Mercury" in Deals › Pipeline.
 *
 * Pipeline mounts the part with its own section; it shows Commit's capacity
 * fact beside the cheques the investor intends on live deals and the headroom
 * between them; it writes nothing; and an unknown figure reads "Not recorded",
 * never $0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import FromMercury, { pipelineLines } from '../src/pages/investor/FromMercury.jsx';
import { mercuryInvestorApi } from '../src/lib/api/mercuryInvestor.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(FromMercury, props)); await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => propsOf(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, text, all: () => text(container), async unmount() { await act(async () => root.unmount()); restore(); } };
}

function stub(over) {
  const saved = { ...mercuryInvestorApi };
  Object.assign(mercuryInvestorApi, over);
  return () => Object.assign(mercuryInvestorApi, saved);
}

const FIG = {
  capacity: { available_cents: 10000000, account_last_fours: ['1357'], as_of: '2026-10-15' },
  intended: { total_cents: 7500000, deals: 2, commitments: 2, unrecorded: 1 },
  headroom_cents: 2500000,
};

test('the lines: capacity beside intended cheques, headroom or over capacity, and unknown is Not recorded', () => {
  // Mutation checked: headroom sign flipped → "Over capacity" never appears; a missing fact as $0 → the first deepEqual fails.
  assert.deepEqual(pipelineLines(FIG), {
    capacity: 'Capacity: $100,000.00 available as of 2026-10-15, from Mercury',
    intended: 'Intended cheques: $75,000.00 across 2 live deals · 1 without an amount, not counted',
    headroom: 'Headroom: $25,000.00',
  });
  assert.equal(pipelineLines({ ...FIG, headroom_cents: -150000 }).headroom, 'Over capacity by $1,500.00');
  const none = pipelineLines({ capacity: null, intended: { total_cents: 0, deals: 1, commitments: 1, unrecorded: 0 }, headroom_cents: null });
  assert.equal(none.capacity, 'Capacity: Not recorded. Pick the accounts that count in Deals › Commit.');
  assert.equal(none.intended, 'Intended cheques: $0.00 across 1 live deal');
  assert.equal(none.headroom, 'Headroom: Not recorded');
});

test('Pipeline reads /pipeline once, draws the three lines, says only you see it, and offers no write', async () => {
  // Mutation checked: Pipeline drawn as Proposals → the proposals call is made and the no-writes assertion fails.
  const calls = [];
  const writes = (name) => async () => { calls.push(name); return {}; };
  const restore = stub({
    pipeline: async () => { calls.push('pipeline'); return FIG; },
    capacity: writes('capacity'), setCapacity: writes('setCapacity'), proposals: writes('proposals'),
    accept: writes('accept'), dismiss: writes('dismiss'), sync: writes('sync'),
  });
  const m = await mount({ section: 'pipeline' });
  try {
    assert.deepEqual(calls, ['pipeline']);
    assert.equal(m.text(m.by('from-mercury-pipeline-capacity')), 'Capacity: $100,000.00 available as of 2026-10-15, from Mercury');
    assert.match(m.text(m.by('from-mercury-pipeline-intended')), /^Intended cheques: \$75,000\.00 across 2 live deals/);
    assert.equal(m.text(m.by('from-mercury-pipeline-headroom')), 'Headroom: $25,000.00');
    assert.match(m.all(), /Only you see this\./);
    assert.ok(!/Accept|Dismiss|Read Mercury/.test(m.all()), 'the Pipeline section has no write control');
  } finally { await m.unmount(); restore(); }
});

test('a refusal on Pipeline reads Not recorded with its reason, never a zero', async () => {
  const restore = stub({ pipeline: async () => { throw Object.assign(new Error('Only an investor reads this.'), { status: 403 }); } });
  const m = await mount({ section: 'pipeline' });
  try {
    assert.equal(m.text(m.by('from-mercury-reason')), 'Not recorded: Only an investor reads this.');
    assert.ok(!/\$0/.test(m.all()));
  } finally { await m.unmount(); restore(); }
});

test('Deals › Pipeline mounts the part with its own section, and the client reads the Worker route', () => {
  // Mutation checked: PipelineZone mounting section="commit" → this fails.
  assert.ok(src('pages/investor/deals/PipelineZone.jsx').includes('<FromMercury section="pipeline" />'));
  assert.match(src('lib/api/mercuryInvestor.js'), /pipeline: \(\) => request\('\/mercury\/investor\/pipeline'\)/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/mercury_investor.ts', import.meta.url), 'utf8');
  assert.match(worker, /app\.get\('\/pipeline'/);
});

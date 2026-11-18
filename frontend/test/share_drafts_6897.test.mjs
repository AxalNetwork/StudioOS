// D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30): Eadwyn's drafts in Share outside Axal — a proposed pack
// selection for one reader that only ticks rows, and a covering line the founder accepts, edits or discards.
// Every run is quoted and runs only on Confirm. Sample data only; the Worker is a stub.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_drafts_6897.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { PackProposal, LineDraft } from '../src/pages/cycles/evidence/ShareDrafts.jsx';
import {
  PACK_NOTE, PACK_ACCEPT_NOTE, PACK_OFF, LINE_NOTE, NO_DRAFT, audienceProblem, draftError, holdLine, proposedRows, tickedLine,
} from '../src/pages/cycles/evidence/shareDraftsModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ROWS = [
  { uid: 'it-kpi', area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_label: 'manual', observed_on: '2026-09-10' },
  { uid: 'it-icp', area: 'Customer evidence', kind: 'icp-fit', source_label: 'interviews', observed_on: '2026-09-07' },
];
const QUOTE = { quote: { hold_microusd: 4000, model: 'synthetic-model', confirm_quote: 'confirm-1' } };
const PACK = { uid: 'd-pack', kind: 'pack', status: 'proposed', audience: '[Seed fund] partner', items: [{ uid: 'it-kpi', reason: 'Traction first.' }, { uid: 'it-gone', reason: 'Made private since.' }], left_out: 'The cap table.' };
const LINE = { uid: 'd-line', kind: 'covering-line', status: 'proposed', line: 'Here is where we stand; the data room is next.' };

test('the model: the hold line, who the pack is for, rows against the composer, what Accept did, and each refusal in words', () => {
  assert.match(holdLine({ hold_microusd: 4000 }), /^Holds up to .+ · you pay what it uses$/);
  assert.equal(holdLine(null), null);
  assert.match(audienceProblem(''), /Say who the pack is for/);
  assert.match(audienceProblem('x'.repeat(121)), /120 characters/);
  assert.match(audienceProblem('send to a@b.co'), /emails and links/);
  assert.equal(audienceProblem('Seed fund partner'), null);
  const rows = proposedRows(PACK, ROWS);
  assert.deepEqual(rows.map((r) => [r.uid, r.available]), [['it-kpi', true], ['it-gone', false]]);
  assert.equal(rows[1].title, 'An item no longer shared');
  assert.equal(rows[0].reason, 'Traction first.');
  assert.equal(tickedLine(['a'], 0), 'Ticked 1 row. You can still change any row.');
  assert.equal(tickedLine(['a', 'b'], 1), 'Ticked 2 rows. You can still change any row. 1 item is no longer shared, so not ticked.');
  assert.equal(draftError({ status: 503, data: { error: 'model_unavailable' } }, PACK_OFF), PACK_OFF);
  assert.match(draftError({ status: 402, data: { error: 'quote_required' } }, PACK_OFF), /cost changed/);
  assert.match(draftError({ status: 409, data: { error: 'empty' } }, PACK_OFF), /Nothing is shared beyond Private/);
  assert.match(draftError({ status: 500 }, PACK_OFF), /Nothing changed/);
  assert.match(PACK_NOTE, /never adds a Private item and never changes sharing/);
  assert.match(PACK_ACCEPT_NOTE, /Accepting only ticks rows; you still create the pack/);
  assert.match(LINE_NOTE, /accept, edit or discard; nothing is added by itself/);
});

async function mount(element, answer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, method, body });
    return answer({ path: u.pathname, method, body }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(element));
  await settle();
  const need = (id) => { const n = byTestId(id); if (!n) throw new Error(`no ${id}`); return n; };
  return {
    calls,
    has: (id) => !!byTestId(id),
    text: (id) => (byTestId(id) ? squash(textOf(byTestId(id))) : null),
    all: (id) => all(id).map((n) => ({ text: squash(textOf(n)), props: props(n) })),
    click: async (id) => { await act(async () => { props(need(id)).onClick({ preventDefault() {} }); }); await settle(); },
    type: async (id, value) => { await act(async () => { props(need(id)).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}
const posts = (ui, tail) => ui.calls.filter((c) => c.method === 'POST' && c.path.endsWith(tail));

test('RA-27 A: who it is for first; the quote before the run; the proposal with reasons; Accept only ticks rows', async () => {
  let ticked = null;
  const ui = await mount(h(PackProposal, { projectId: 1, rows: ROWS, onTick: (u) => { ticked = u; } }), ({ path }) => {
    if (path.endsWith('/share-drafts/quote')) return json(QUOTE);
    if (path.endsWith('/share-drafts/run')) return json({ draft: PACK, cost: { usage_log_id: 1, charged_microusd: 900 } });
    if (path.endsWith('/share-drafts/d-pack/accept')) return json({ draft: { uid: 'd-pack', status: 'accepted' }, tick: ['it-kpi'], dropped: 1 });
    return null;
  });
  try {
    await ui.click('share-proposal-ask');
    assert.equal(ui.calls.length, 0, 'nothing is asked without who it is for');
    assert.match(ui.text('share-proposal'), /Say who the pack is for/);
    await ui.type('share-proposal-audience', '[Seed fund] partner');
    await ui.click('share-proposal-ask');
    assert.deepEqual(posts(ui, '/quote')[0].body, { kind: 'pack', audience: '[Seed fund] partner' });
    assert.equal(posts(ui, '/run').length, 0, 'a quote is not a run');
    assert.match(ui.text('share-proposal-hold'), /Holds up to .+ · you pay what it uses/);
    await ui.click('share-proposal-run');
    // Mutation checked: run without the quote's confirmation → the body lacks confirm_quote and this fails.
    assert.deepEqual(posts(ui, '/run')[0].body, { kind: 'pack', audience: '[Seed fund] partner', confirm_quote: 'confirm-1' });
    const rows = ui.all('share-proposal-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0].text, /Traction first\./);
    assert.equal(rows[1].props['data-available'], 'no');
    assert.match(rows[1].text, /not ticked/);
    assert.match(ui.text('share-proposal-left-out'), /^Left out: The cap table\.$/);
    assert.equal(ticked, null, 'a proposal ticks nothing by itself');
    await ui.click('share-proposal-accept');
    assert.deepEqual(ticked, ['it-kpi'], 'Accept ticks the rows the Worker returned, nothing else');
    assert.equal(ui.text('share-proposal-done'), 'Ticked 1 row. You can still change any row. 1 item is no longer shared, so not ticked.');
    assert.equal(ui.calls.filter((c) => /share-links|pdf-copies/.test(c.path)).length, 0, 'no pack is made from here');
  } finally { await ui.close(); }
});

test('RA-27 A: Discard ticks nothing; an unavailable model says the pack works without a proposal', async () => {
  let ticked = null;
  let up = true;
  const ui = await mount(h(PackProposal, { projectId: 1, rows: ROWS, onTick: (u) => { ticked = u; } }), ({ path }) => {
    if (path.endsWith('/share-drafts/quote')) return up ? json(QUOTE) : json({ error: 'model_unavailable', message: 'down' }, 503);
    if (path.endsWith('/share-drafts/run')) return json({ draft: PACK });
    if (path.endsWith('/share-drafts/d-pack/discard')) return json({ draft: { uid: 'd-pack', status: 'discarded' } });
    return null;
  });
  try {
    await ui.type('share-proposal-audience', '[Seed fund] partner');
    await ui.click('share-proposal-ask');
    await ui.click('share-proposal-run');
    await ui.click('share-proposal-discard');
    assert.equal(ticked, null);
    assert.match(ui.text('share-proposal-done'), /Discarded\. Nothing was ticked\./);
    up = false;
    await ui.click('share-proposal-ask');
    assert.equal(ui.text('share-proposal-notice'), PACK_OFF);
  } finally { await ui.close(); }
});

test('RA-30: the covering line is quoted, then Accept fills the field; Edit sends the founder’s words; a run with nothing usable says so', async () => {
  let used = null;
  let answer = { draft: LINE };
  const ui = await mount(h(LineDraft, { projectId: 1, onUse: (l) => { used = l; } }), ({ path, body }) => {
    if (path.endsWith('/share-drafts/quote')) return json(QUOTE);
    if (path.endsWith('/share-drafts/run')) return json(answer);
    if (path.endsWith('/share-drafts/d-line/accept')) return json(body?.line ? { draft: { uid: 'd-line', status: 'edited' }, line: body.line } : { draft: { uid: 'd-line', status: 'accepted' }, line: LINE.line });
    return null;
  });
  try {
    await ui.click('share-line-ask');
    assert.deepEqual(posts(ui, '/quote')[0].body, { kind: 'covering-line' });
    await ui.click('share-line-run');
    assert.equal(ui.text('share-line-text'), `“${LINE.line}”`);
    assert.equal(used, null, 'nothing is added by itself');
    await ui.click('share-line-accept');
    assert.equal(used, LINE.line);
    assert.deepEqual(posts(ui, '/d-line/accept')[0].body, {});

    await ui.click('share-line-ask');
    await ui.click('share-line-run');
    await ui.click('share-line-edit-open');
    await ui.type('share-line-edit', 'The data room is our gap, and it is next.');
    await ui.click('share-line-keep');
    // Mutation checked: send the proposed line instead of the edit → this fails.
    assert.deepEqual(posts(ui, '/d-line/accept')[1].body, { line: 'The data room is our gap, and it is next.' });
    assert.equal(used, 'The data room is our gap, and it is next.');
    assert.match(ui.text('share-line-done'), /Your edit is in the covering line/);

    answer = { draft: null };
    await ui.click('share-line-ask');
    await ui.click('share-line-run');
    assert.equal(ui.text('share-line-notice'), NO_DRAFT);
  } finally { await ui.close(); }
});

test('wiring: the composer offers the proposal only with an NDA reader and ticks through its own picked set; the snapshot fills its own field', () => {
  const outside = readFileSync(new URL('../src/pages/cycles/evidence/ShareOutside.jsx', import.meta.url), 'utf8');
  assert.match(outside, /\{after && preview\?\.items\?\.state === 'recorded' && preview\.items\.rows\.length\s*\? <PackProposal [^>]*onTick=\{\(uids\) => setPicked\(new Set\(uids\)\)\}/);
  const readiness = readFileSync(new URL('../src/pages/cycles/evidence/ShareReadiness.jsx', import.meta.url), 'utf8');
  assert.match(readiness, /<LineDraft projectId=\{projectId\} onUse=\{\(line\) => setForm\(\(f\) => \(\{ \.\.\.f, covering_line: line \|\| '' \}\)\)\} \/>/);
});

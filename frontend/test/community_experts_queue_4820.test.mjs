/**
 * D4820 (#4820) part 3 — the wellbeing experts waiting to be verified in
 * Waiting on you and Needs your attention (CM02), from the Community read's
 * `queue.experts` (the same rule as Approvals' wellbeing_experts lane). Each
 * row names the profile's headline, never the expert, and opens the item in
 * Approvals. Every record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_experts_queue_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import { COMMUNITY_PATH, buildConsoles, buildNeeds, buildTiles, oldestWait } from '../src/pages/admin/community/communityModel.js';
import { expertQueueOf } from '../src/pages/admin/community/model/queues.js';
import { checkOverview } from '../src/pages/admin/community/model/contract.js';
import { itemOfPath } from '../src/pages/admin/approvals/inboxModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const ok = (data) => ({ status: 'ready', data });
const UNREAD = { available: false, unreadable: true, reason: 'The wellbeing experts queue could not be read on this database. That is not the same as none.' };

/** Two experts waiting: one past 72 hours with a headline, one recent with none. */
function withExperts() {
  const o = full();
  o.blocks.queue.experts = {
    available: true, pending: 3, overdue: 1, oldest_wait_hours: 200,
    rows: [
      { expert_id: 41, headline: 'Sleep and recovery coach', waiting_since: at(-200), waiting_hours: 200, overdue: true },
      { expert_id: 42, headline: null, waiting_since: at(-2), waiting_hours: 2, overdue: false },
    ],
  };
  return o;
}
const put = (answer, path, value) => {
  const o = structuredClone(answer);
  const keys = path.split('.');
  let n = o;
  for (const k of keys.slice(0, -1)) n = n[k];
  n[keys.at(-1)] = value;
  return o;
};

// ---------------------------------------------------------------- the model

test('D4820 part 3: Waiting on you adds the experts to verify, and its oldest wait and amber dot count them', () => {
  const t = buildTiles({ overview: ok(withExperts()) }).find((x) => x.key === 'waiting');
  // Mutation checked: leaving q.experts out of the sum → '4' and this fails.
  assert.equal(t.value, '7');
  assert.equal(t.sub, '2 events · 2 jobs · 3 experts · oldest 8 days');
  assert.equal(t.overdue, true);
  // An expert queue that could not be read is no total, never a partial sum.
  const gone = buildTiles({ overview: ok(put(withExperts(), 'blocks.queue.experts', UNREAD)) }).find((x) => x.key === 'waiting');
  assert.equal(gone.state, 'unreadable');
  assert.match(oldestWait(ok(put(withExperts(), 'blocks.queue.experts', UNREAD))).note, /How long experts have waited could not be read/);
});

test('D4820 part 3: the experts queue is read strictly — a bad count or row is unreadable, never 0', () => {
  assert.equal(expertQueueOf(ok(withExperts())).state, 'ready');
  for (const [path, value] of [
    ['blocks.queue.experts.pending', '3'],
    ['blocks.queue.experts.overdue', 4],
    ['blocks.queue.experts.oldest_wait_hours', -1],
    ['blocks.queue.experts.rows', null],
    ['blocks.queue.experts.rows.0.expert_id', 0],
    ['blocks.queue.experts.rows.0.waiting_hours', 1.5],
    ['blocks.queue.experts.rows.1.headline', 7],
    ['blocks.queue.experts.pending', 1],
  ]) {
    // Mutation checked: dropping the row check from expertQueueOf → the rows cases pass as ready and this fails.
    assert.equal(expertQueueOf(ok(put(withExperts(), path, value))).state, 'unreadable', `${path} = ${JSON.stringify(value)}`);
  }
  // The contract names a broken experts block.
  assert.ok(checkOverview(put(withExperts(), 'blocks.queue.experts.pending', '3')).some((l) => l.startsWith('blocks.queue.experts')));
  assert.deepEqual(checkOverview(withExperts()), []);
});

test('D4820 part 3: Needs your attention lists experts by headline, Overdue first, and never names the expert', () => {
  const n = buildNeeds({ overview: ok(withExperts()) });
  assert.equal(n.total, 7);
  assert.equal(n.overdue, 2);
  // Overdue first and then oldest (part 1's sort): an Overdue item is always the older, so this pins the order, not the key.
  assert.deepEqual(n.rows.map((r) => [r.kind, r.title, r.overdue]).slice(0, 3), [
    ['Expert', 'Sleep and recovery coach', true],
    ['Event', 'Pricing Clinic', true],
    ['Job', 'Backend Engineer', false],
  ]);
  const blank = n.rows.find((r) => r.ref === 42);
  assert.equal(blank.title, 'Wellbeing expert, no headline', 'an expert with no headline is never a blank row');
  assert.equal(blank.sub, 'Verification pending');
  assert.equal(blank.wait, 'waiting 2 hours · since created');
  assert.deepEqual(n.byKind, { events: 2, jobs: 2, experts: 3 });
});

test('D4820 part 3: clear only when all three queues were read and count none; one unread queue is named', () => {
  const quiet = (o) => {
    o.blocks.queue.events = { available: true, count: 0, oldest_since: null, oldest_hours: null, overdue: 0, overdue_after_hours: 72, waiting_from_created_at: 0 };
    o.blocks.queue.event_rows = { available: true, total: 0, rows: [] };
    o.blocks.queue.jobs = { available: true, pending: 0, overdue: 0, wait_not_recorded: 0, oldest_wait_hours: null, review: [] };
    o.blocks.queue.experts = { available: true, pending: 0, overdue: 0, oldest_wait_hours: null, rows: [] };
    return o;
  };
  assert.equal(buildNeeds({ overview: ok(quiet(full())) }).clear, true);
  const unread = put(quiet(full()), 'blocks.queue.experts', UNREAD);
  // Mutation checked: `clear` without `exOk` → an unread experts queue is called clear and this fails.
  assert.equal(buildNeeds({ overview: ok(unread) }).clear, false);
  assert.equal(buildNeeds({ overview: ok(unread) }).partial, 'The wellbeing experts queue could not be read, so only events and jobs are listed.');
  const pending = put(quiet(full()), 'blocks.queue.experts', withExperts().blocks.queue.experts);
  assert.equal(buildNeeds({ overview: ok(pending) }).clear, false, 'experts waiting is not clear');
});

test('D4820 part 3: Manage Community\'s Wellbeing figure is the experts queue\'s count', () => {
  assert.equal(buildConsoles({ overview: ok(withExperts()) }).wellbeing.text, '3 to verify');
  assert.equal(buildConsoles({ overview: ok(put(withExperts(), 'blocks.queue.experts', UNREAD)) }).wellbeing.state, 'unreadable');
});

// ---------------------------------------------------------------- mounted

async function mount(answer) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json({ rows: [], as_of: at(0) });
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4`] }, h(AdminCommunity))); });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    href: (id) => props(byTestId(id))?.href,
    text: () => textOf(container),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted D4820 part 3: an expert row opens its item in Approvals, and the card counts each kind', async () => {
  const m = await mount(withExperts());
  try {
    // Mutation checked: the expert branch linking `jobs-` → this fails, and Approvals would open the wrong lane.
    assert.equal(m.href('community-need-open-expert-41'), '/admin/approvals/items/wellbeing_experts-41');
    assert.deepEqual(itemOfPath(m.href('community-need-open-expert-41')), { lane: 'wellbeing_experts', id: 41 }, 'Approvals reads the address');
    assert.match(m.of('community-need-wait-expert-41'), /Overdue.*waiting 8 days · since created/);
    assert.equal(m.of('community-needs-kinds'), '2 events · 2 jobs · 3 experts');
    assert.match(m.of('community-tile-waiting'), /7.*3 experts/s);
    assert.match(m.of('community-manage-wellbeing'), /3 to verify/);
  } finally { await m.unmount(); }
});

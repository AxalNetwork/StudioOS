/**
 * #4685 (D4685) — Pipeline drafts and writes stay dependable.
 *
 * Mounted React tests, not source greps. They drive the real Pipeline board
 * and the four partner Pipeline zones through the fake DOM in
 * `_contracts_dom.mjs`, with the `api` methods stubbed, and check what a
 * person would see: a card only stays in its new column if the server took the
 * move; a failed save keeps what was typed; a background refresh keeps the
 * editors that are open; and a version typed for one proposal cannot be
 * submitted to another.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_drafts_4685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PipelinePage from '../src/pages/PipelinePage.jsx';
import PartnerProposalsZone from '../src/pages/partner/pipeline/ProposalsZone.jsx';
import PartnerLeadsZone from '../src/pages/partner/pipeline/LeadsZone.jsx';
import PartnerNegotiationsZone from '../src/pages/partner/pipeline/NegotiationsZone.jsx';
import { usePipelineZone } from '../src/pages/partner/pipeline/usePipelineZone.js';
import PartnerRetainersZone from '../src/pages/partner/pipeline/RetainersZone.jsx';

const h = React.createElement;
const RAW = 'raw-server-detail-4685';
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

/** Stub `api` methods for one test and put every one back afterwards. */
function stub(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete api[k]; else api[k] = v; } };
}

/** Finders over the mounted tree. */
function ui(m) {
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const buttons = (label) => m.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    textOf,
    buttons,
    async press(label, i = 0) {
      const n = buttons(label)[i];
      if (!n) throw new Error('Missing button: ' + label);
      if (m.props(n).disabled) throw new Error('Disabled button: ' + label);
      // Not awaited: a handler waiting on a held request would otherwise hold `act` open with it.
      await act(async () => { m.props(n).onClick({ stopPropagation() {} }); });
    },
    inputs: (tag = 'INPUT') => m.nodes().filter((n) => n.tagName === tag),
    byPlaceholder: (p) => m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).placeholder === p),
    async type(node, value) { await act(async () => { m.props(node).onChange({ target: { value } }); }); },
    value: (node) => m.props(node).value,
  };
}

/* ───────────────────────── the studio board ───────────────────────── */

const deal = (id, name, stage) => ({
  id, name, sector: 'saas', pipeline_stage: stage,
  task_counts: { todo: 0, in_progress: 0, done: 0 }, latest_metrics: null, latest_gate: null,
});
const detail = (id, stage) => ({
  id, current_stage: stage, project: { name: `Deal ${id}`, status: 'active' },
  tasks: [], metrics: [], gates: [], stages: [],
});

/** Stage column nodes, in board order, and the card for a deal name. */
function board(m) {
  const u = ui(m);
  const cols = m.nodes().filter((n) => m.props(n)?.onDrop);
  const card = (name) => m.nodes().find((n) => m.props(n)?.draggable && u.textOf(n).includes(name));
  // One transfer object per drag, as a browser makes: the id set at dragstart is what the drop reads.
  const transfer = () => { const store = {}; return { dataTransfer: { effectAllowed: '', dropEffect: '', setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '' } }; };
  return {
    cols,
    card,
    /** A drop in the same event turn: no awaits between the calls. */
    drag(name, colIndex) {
      const c = card(name);
      const t = transfer();
      m.props(c).onDragStart({ ...t, preventDefault() {} });
      m.props(cols[colIndex]).onDrop({ ...t, preventDefault() {} });
    },
    columnOf: (name) => { const c = card(name); for (let p = c; p; p = p.parentNode) { const i = cols.indexOf(p); if (i >= 0) return i; } return -1; },
  };
}

async function mountBoard(deals, extra = {}) {
  const restore = stub({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    pipelineActive: async () => deals.map((d) => ({ ...d })),
    getVotes: async () => { throw new Error('no votes'); },
    pipelineDealDetail: async (id) => detail(id, deals.find((d) => d.id === id)?.pipeline_stage || 'idea'),
    ...extra,
  });
  const m = await mountContracts(h(PipelinePage, { embedded: true }));
  await m.flush();
  return { m, restore };
}

test('two moves made in one event turn each send their own request (no state-updater side effects)', async () => {
  const sent = [];
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea'), deal(2, 'Beta', 'idea')], {
    pipelineAdvance: async (id, stage) => { sent.push([id, stage]); return {}; },
  });
  try {
    const b = board(m);
    // No await between the two drops: the second `setState` lands on a fiber that
    // already has a pending update, which is when React defers its updater. The old
    // handler read the prior stage out of that updater and silently did nothing.
    await act(async () => { b.drag('Alpha', 1); b.drag('Beta', 2); });
    await m.flush();
    assert.deepEqual(sent, [[1, 'mvp_dev'], [2, 'traction_review']]);
    const after = board(m);
    assert.equal(after.columnOf('Alpha'), 1);
    assert.equal(after.columnOf('Beta'), 2);
  } finally { await m.unmount(); restore(); }
});

test('a card stays in its new column only after the server confirmed the write', async () => {
  const write = deferred();
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], { pipelineAdvance: () => write.promise });
  try {
    await act(async () => { board(m).drag('Alpha', 1); });
    assert.equal(board(m).columnOf('Alpha'), 1, 'shown at once, marked as saving');
    await act(async () => { write.resolve({}); });
    await m.flush();
    assert.equal(board(m).columnOf('Alpha'), 1);
    assert.doesNotMatch(m.text(), /Could not move/);
  } finally { await m.unmount(); restore(); }
});

test('a failed move puts the card back, says so in the page, and Try again sends it again', async () => {
  let fail = true;
  const sent = [];
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], {
    pipelineAdvance: async (id, stage) => { sent.push([id, stage]); if (fail) throw new Error(RAW); return {}; },
  });
  const u = ui(m);
  try {
    await act(async () => { board(m).drag('Alpha', 1); });
    await m.flush();
    assert.equal(board(m).columnOf('Alpha'), 0, 'back in Idea');
    assert.match(m.text(), /Could not move "Alpha" to MVP Dev\. It is back in Idea\./);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    fail = false;
    await u.press('Try again');
    await m.flush();
    assert.equal(board(m).columnOf('Alpha'), 1);
    assert.doesNotMatch(m.text(), /Could not move/);
    assert.equal(sent.length, 2);
  } finally { await m.unmount(); restore(); }
});

test('a read that began before a move cannot undo it when it lands afterwards', async () => {
  const slow = deferred();
  let reads = 0;
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], {
    // Read 2 is the one held open. A read that began before the move is dropped and replaced (#4701),
    // and the replacement (read 3) sees the server as it is after the move.
    pipelineActive: () => {
      reads += 1;
      if (reads === 1) return Promise.resolve([deal(1, 'Alpha', 'idea')]);
      return reads === 2 ? slow.promise : Promise.resolve([deal(1, 'Alpha', 'mvp_dev')]);
    },
    pipelineAdvance: async () => ({}),
    pipelineTriggerReview: async () => ({}),
  });
  const u = ui(m);
  try {
    // Open the drawer; its "Trigger AI Review" starts a board reload that we hold open.
    await act(async () => { await m.props(board(m).card('Alpha')).onClick(); });
    await m.flush();
    await u.press('Trigger AI Review');
    await m.flush();
    assert.equal(reads, 2, 'the reload is in flight');
    await act(async () => { board(m).drag('Alpha', 1); });
    await m.flush();
    await act(async () => { slow.resolve([deal(1, 'Alpha', 'idea')]); });
    await m.flush();
    assert.equal(board(m).columnOf('Alpha'), 1, 'the stale snapshot did not move it back');
  } finally { await m.unmount(); restore(); }
});

test('saving in the deal drawer refreshes in the background and keeps an open form and its text', async () => {
  let detailReads = 0;
  const refresh = deferred();
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], {
    pipelineTriggerReview: async () => ({}),
    // The first read answers at once; the refresh after the save is held open, so
    // the page is observed MID-refresh, which is when a skeleton would show.
    pipelineDealDetail: (id) => { detailReads += 1; return detailReads === 1 ? Promise.resolve(detail(id, 'idea')) : refresh.promise; },
  });
  const u = ui(m);
  try {
    await act(async () => { await m.props(board(m).card('Alpha')).onClick(); });
    await m.flush();
    await u.press('MVP Tasks (0)');
    await u.press('Add Task');
    await u.type(u.byPlaceholder('Task title'), 'Draft the launch plan');
    const before = detailReads;
    await u.press('Trigger AI Review');
    await m.flush();
    assert.ok(detailReads > before, 'the drawer did refresh');
    assert.equal(u.value(u.byPlaceholder('Task title')), 'Draft the launch plan', 'mid-refresh');
    await act(async () => { refresh.resolve(detail(1, 'idea')); });
    await m.flush();
    assert.equal(u.value(u.byPlaceholder('Task title')), 'Draft the launch plan', 'after the refresh');
  } finally { await m.unmount(); restore(); }
});

test('a failed task save keeps the form and its text and says so without the server text', async () => {
  let fail = true;
  const created = [];
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], {
    pipelineCreateTask: async (b) => { created.push(b); if (fail) throw new Error(RAW); return {}; },
  });
  const u = ui(m);
  try {
    await act(async () => { await m.props(board(m).card('Alpha')).onClick(); });
    await m.flush();
    await u.press('MVP Tasks (0)');
    await u.press('Add Task');
    await u.type(u.byPlaceholder('Task title'), 'Ship the beta');
    await u.press('Add');
    await m.flush();
    assert.equal(u.value(u.byPlaceholder('Task title')), 'Ship the beta');
    assert.match(m.text(), /The task was not added/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    fail = false;
    await u.press('Add');
    await m.flush();
    assert.equal(created.length, 2);
    assert.equal(u.byPlaceholder('Task title'), undefined, 'form closes once saved');
  } finally { await m.unmount(); restore(); }
});

test('a failed stage move from the drawer puts the drawer back too', async () => {
  const { m, restore } = await mountBoard([deal(1, 'Alpha', 'idea')], {
    pipelineAdvance: async () => { throw new Error(RAW); },
  });
  const u = ui(m);
  try {
    await act(async () => { await m.props(board(m).card('Alpha')).onClick(); });
    await m.flush();
    await u.press('MVP Dev');
    await m.flush();
    assert.equal(board(m).columnOf('Alpha'), 0);
    assert.match(m.text(), /The stage did not change/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    assert.match(m.text(), /Current StageIdea/, 'the drawer shows the stage it came from');
  } finally { await m.unmount(); restore(); }
});

/* ───────────────────── partner Pipeline · Proposals ───────────────────── */

const proposal = (id, client) => ({
  quote_id: id, client, need_title: `${client} need`, shape: 'Project', price_dollars: 10000, version: 1,
  state: 'Sent', status: 'submitted', versions: [], signal: 'Sent', loss_reason: null, days_since_sent: 2,
});
const proposalsBody = (items) => ({ items, loss_reasons: [], live_count: items.length, live_value_dollars: 0, won_count: 0, decided_count: 0, win_rate_pct: null });

async function mountProposals(items, extra = {}) {
  const restore = stub({ listPartnerProposals: async () => proposalsBody(items), ...extra });
  const m = await mountContracts(h(PartnerProposalsZone));
  await m.flush();
  return { m, restore, u: ui(m) };
}

/** The three version-form inputs, in order: what changed, why, price. */
const versionInputs = (m) => m.nodes().filter((n) => n.tagName === 'INPUT' && [400, 600, undefined].includes(m.props(n)?.maxLength) && (m.props(n)?.maxLength === 400 || m.props(n)?.maxLength === 600 || m.props(n)?.placeholder === 'e.g. 41000'));
const chooseProposal = async (m, id) => {
  const sel = m.nodes().find((n) => n.tagName === 'SELECT' && m.props(n).value !== undefined && [...n.childNodes].some((o) => o.textContent === 'Choose one'));
  await act(async () => { m.props(sel).onChange({ target: { value: id == null ? '' : String(id) } }); });
};

test('a version typed for one proposal is submitted to that proposal, whatever History is open', async () => {
  const calls = [];
  const { m, restore, u } = await mountProposals(
    [{ ...proposal(1, 'Acme'), versions: [{ id: 11, version: 1, change_summary: 'first', created_at: '2026-11-01', price_cents: null, note: '' }] }, proposal(2, 'Birch')].map((p, i) => (i === 1 ? { ...p, versions: [{ id: 21, version: 1, change_summary: 'b first', created_at: '2026-11-01', price_cents: null, note: '' }] } : p)),
    { addPartnerProposalVersion: async (id, body) => { calls.push([id, body]); return {}; } },
  );
  try {
    await chooseProposal(m, 1);
    const [what] = versionInputs(m);
    await u.type(what, 'Split into phases');
    // Look at the other proposal's history. This used to retarget the form to it.
    await u.press('History', 1);
    assert.match(m.text(), /Version history · Birch/);
    await u.press('Add the version');
    await m.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 1, 'sent to the proposal the form was aimed at, not the one History showed');
    assert.equal(calls[0][1].change_summary, 'Split into phases');
  } finally { await m.unmount(); restore(); }
});

test('drafts are kept per proposal: switching away and back finds each as it was left', async () => {
  const { m, restore, u } = await mountProposals([proposal(1, 'Acme'), proposal(2, 'Birch')]);
  try {
    await chooseProposal(m, 1);
    await u.type(versionInputs(m)[0], 'Acme draft');
    await chooseProposal(m, 2);
    assert.equal(u.value(versionInputs(m)[0]), '', 'Birch starts empty, not with Acme’s text');
    await u.type(versionInputs(m)[0], 'Birch draft');
    await chooseProposal(m, 1);
    assert.equal(u.value(versionInputs(m)[0]), 'Acme draft');
    await chooseProposal(m, 2);
    assert.equal(u.value(versionInputs(m)[0]), 'Birch draft');
  } finally { await m.unmount(); restore(); }
});

test('a failed version save keeps the draft, shows one fixed sentence, and a retry then clears it', async () => {
  let fail = true;
  const calls = [];
  const { m, restore, u } = await mountProposals([proposal(1, 'Acme')], {
    addPartnerProposalVersion: async (id, body) => { calls.push(body); if (fail) throw new Error(RAW); return {}; },
  });
  try {
    await chooseProposal(m, 1);
    await u.type(versionInputs(m)[0], 'Lower the fee');
    await u.type(versionInputs(m)[2], '41000');
    await u.press('Add the version');
    await m.flush();
    assert.equal(u.value(versionInputs(m)[0]), 'Lower the fee');
    assert.equal(u.value(versionInputs(m)[2]), '41000');
    assert.match(m.text(), /That did not save\. What you typed is still here/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    fail = false;
    await u.press('Add the version');
    await m.flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].price_cents, 4100000);
    assert.equal(u.value(versionInputs(m)[0]), '');
    assert.match(m.text(), /Version recorded\./);
  } finally { await m.unmount(); restore(); }
});

test('choosing another proposal while a save is in flight neither retargets it nor clears the other draft', async () => {
  const write = deferred();
  const calls = [];
  const { m, restore, u } = await mountProposals([proposal(1, 'Acme'), proposal(2, 'Birch')], {
    addPartnerProposalVersion: (id, body) => { calls.push([id, body.change_summary]); return write.promise; },
  });
  try {
    await chooseProposal(m, 1);
    await u.type(versionInputs(m)[0], 'Acme change');
    await u.press('Add the version');
    await chooseProposal(m, 2);
    await u.type(versionInputs(m)[0], 'Birch change');
    await act(async () => { write.resolve({}); });
    await m.flush();
    assert.deepEqual(calls, [[1, 'Acme change']]);
    assert.equal(u.value(versionInputs(m)[0]), 'Birch change', 'Birch’s draft survived Acme’s save');
    await chooseProposal(m, 1);
    assert.equal(u.value(versionInputs(m)[0]), '', 'Acme’s was cleared, since it saved');
  } finally { await m.unmount(); restore(); }
});

test('a refresh after a save keeps the zone mounted, so the draft in another proposal survives', async () => {
  const reload = deferred();
  let reads = 0;
  const items = [proposal(1, 'Acme'), proposal(2, 'Birch')];
  const { m, restore, u } = await mountProposals(items, {
    listPartnerProposals: () => { reads += 1; return reads === 1 ? Promise.resolve(proposalsBody(items)) : reload.promise; },
    addPartnerProposalVersion: async () => ({}),
  });
  try {
    await chooseProposal(m, 1);
    await u.type(versionInputs(m)[0], 'Acme change');
    await u.press('Add the version');
    await m.flush();
    assert.equal(reads, 2);
    // Mid-refresh the rows and form are still on screen, not a skeleton.
    assert.match(m.text(), /Record a version, or why one was lost/);
    await chooseProposal(m, 2);
    await u.type(versionInputs(m)[0], 'Birch change');
    await act(async () => { reload.resolve(proposalsBody(items)); });
    await m.flush();
    assert.equal(u.value(versionInputs(m)[0]), 'Birch change');
  } finally { await m.unmount(); restore(); }
});

test('a slower, older read cannot overwrite a newer one', async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  let api4685;
  function Probe() {
    const z = usePipelineZone(() => { reads += 1; return reads === 1 ? first.promise : second.promise; }, 'x');
    api4685 = z;
    return h('p', null, z.state.loading ? 'loading' : z.state.error || JSON.stringify(z.state.data));
  }
  const m = await mountContracts(h(Probe));
  try {
    await act(async () => { api4685.load(); }); // a newer read starts while the first is still out
    await act(async () => { second.resolve({ who: 'newer' }); });
    assert.match(m.text(), /newer/);
    await act(async () => { first.resolve({ who: 'older' }); });
    await m.flush();
    assert.match(m.text(), /newer/, 'the older response was dropped');
    assert.doesNotMatch(m.text(), /older/);
  } finally { await m.unmount(); }
});

test('a refresh that fails keeps the last good rows instead of blanking the zone', async () => {
  let fail = false;
  let api4685;
  function Probe() {
    const z = usePipelineZone(async () => { if (fail) throw new Error(RAW); return { who: 'kept' }; }, 'The list did not load.');
    api4685 = z;
    return h('p', null, z.state.loading ? 'loading' : z.state.error || JSON.stringify(z.state.data));
  }
  const m = await mountContracts(h(Probe));
  try {
    await m.flush();
    assert.match(m.text(), /kept/);
    fail = true;
    await act(async () => { await api4685.load(); });
    assert.match(m.text(), /kept/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
  } finally { await m.unmount(); }
});

test('a first read that fails says one fixed sentence, never the server text; no partner profile keeps its own line', async () => {
  let message = RAW;
  function Probe() {
    const z = usePipelineZone(async () => { throw new Error(message); }, 'The list did not load.');
    return h('p', null, z.state.error);
  }
  let m = await mountContracts(h(Probe));
  try { await m.flush(); assert.equal(m.text(), 'The list did not load.'); } finally { await m.unmount(); }
  message = 'No partner profile for this account';
  m = await mountContracts(h(Probe));
  try { await m.flush(); assert.match(m.text(), /no partner profile/i); assert.doesNotMatch(m.text(), /for this account/); } finally { await m.unmount(); }
});

/* ─────────────────────────── partner Pipeline · Leads ─────────────────────────── */

const lead = (id, who) => ({
  need_id: id, who, title: `${who} wants a site`, source_label: 'Marketplace', days_old: 3, budget_max: null,
  timeline: null, need: null, score: 70, excluded_by: null, receipts: [], score_note: null,
});
const leadsBody = (items) => ({ items, passed: [], open_count: items.length, strong_fit_count: 0 });
const passSelects = (m) => m.nodes().filter((n) => n.tagName === 'SELECT' && [...n.childNodes].some((o) => o.textContent === 'Choose one'));
const passNotes = (m) => m.nodes().filter((n) => n.tagName === 'INPUT' && m.props(n).maxLength === 600);
const pickReason = async (m, i, value) => { await act(async () => { m.props(passSelects(m)[i]).onChange({ target: { value } }); }); };

test('Leads: recording one pass refreshes in the background and the other open pass editor keeps its text', async () => {
  const reload = deferred();
  let reads = 0;
  const items = [lead(1, 'Acme'), lead(2, 'Birch')];
  const calls = [];
  const restore = stub({
    listPartnerLeads: () => { reads += 1; return reads === 1 ? Promise.resolve(leadsBody(items)) : reload.promise; },
    passPartnerLead: async (id, body) => { calls.push([id, body]); return {}; },
  });
  const m = await mountContracts(h(PartnerLeadsZone));
  const u = ui(m);
  try {
    await m.flush();
    await u.press('Pass', 0);
    await u.press('Pass', 0); // card 1 now reads "Cancel", so this is card 2's
    await u.type(passNotes(m)[0], 'Acme: budget too low');
    await pickReason(m, 1, 'timing');
    await u.press('Record the pass', 1);
    await m.flush();
    assert.equal(reads, 2, 'the refresh is in flight');
    assert.equal(passNotes(m).length, 2, 'both editors are still mounted mid-refresh');
    assert.equal(u.value(passNotes(m)[0]), 'Acme: budget too low');
    await act(async () => { reload.resolve(leadsBody(items)); });
    await m.flush();
    assert.deepEqual(calls.map((c) => c[0]), [2]);
    assert.equal(u.value(passNotes(m)[0]), 'Acme: budget too low', 'card 1 kept its text after the refresh landed');
    assert.equal(passNotes(m).length, 1, 'card 2’s editor closed because its pass saved');
  } finally { await m.unmount(); restore(); }
});

test('Leads: a failed pass keeps the editor open with the reason and note, says so, and retry closes it', async () => {
  let fail = true;
  const restore = stub({
    listPartnerLeads: async () => leadsBody([lead(1, 'Acme')]),
    passPartnerLead: async () => { if (fail) throw new Error(RAW); return {}; },
  });
  const m = await mountContracts(h(PartnerLeadsZone));
  const u = ui(m);
  try {
    await m.flush();
    await u.press('Pass');
    await pickReason(m, 0, 'price');
    await u.type(passNotes(m)[0], 'Too low');
    await u.press('Record the pass');
    await m.flush();
    assert.equal(u.value(passNotes(m)[0]), 'Too low');
    assert.equal(m.props(passSelects(m)[0]).value, 'price');
    assert.match(m.text(), /That did not save\. What you typed is still here/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    fail = false;
    await u.press('Record the pass');
    await m.flush();
    assert.equal(passNotes(m).length, 0, 'closed only now');
  } finally { await m.unmount(); restore(); }
});

/* ──────────────────────── partner Pipeline · Negotiations ──────────────────────── */

const negotiation = (id, name, terms = []) => ({
  quote_id: id, quote_uid: `Q-${id}`, need_title: name, need_category: 'web', quote_status: 'submitted', price: 5000,
  negotiation: { stage: 'scoping', ball: 'them', open_question: '', days_stalled: 1, last_moved_at: '2026-11-01' },
  terms,
});
const term = (id, label) => ({ id, label, our_position: 'ours', their_position: 'theirs', landing: '', state: 'open' });
const negBody = (items) => ({ items, tracked_count: items.length });
const termBoxes = (m) => m.nodes().filter((n) => n.tagName === 'INPUT' && m.props(n).maxLength === 160);

test('Negotiations: a failed term save keeps the term editor and what was typed; retry closes it', async () => {
  let fail = true;
  const calls = [];
  const restore = stub({
    listPartnerNegotiations: async () => negBody([negotiation(1, 'Acme site', [term(7, 'Payment terms')])]),
    updatePartnerNegotiationTerm: async (id, body) => { calls.push([id, body.label]); if (fail) throw new Error(RAW); return {}; },
  });
  const m = await mountContracts(h(PartnerNegotiationsZone));
  const u = ui(m);
  try {
    await m.flush();
    // D5938: a negotiation's terms open in its sheet (PP05b), from the card's "Open terms".
    await u.press('Open terms');
    await u.press('Edit');
    await u.type(termBoxes(m)[0], 'Payment terms: net 45');
    await u.press('Save term');
    await m.flush();
    assert.equal(u.value(termBoxes(m)[0]), 'Payment terms: net 45', 'still editing, text intact');
    assert.match(m.text(), /That did not save\. What you typed is still here/);
    assert.doesNotMatch(m.text(), new RegExp(RAW));
    fail = false;
    await u.press('Save term');
    await m.flush();
    assert.equal(termBoxes(m).length, 0, 'closed after the server took it');
    assert.equal(calls.length, 2);
  } finally { await m.unmount(); restore(); }
});

// D5938: one negotiation's sheet is open at a time (PP05b), so the background
// refresh is the one its own stage save starts, under a term still being typed.
test('Negotiations: saving a stage refreshes in the background; the sheet’s open term editor keeps its draft', async () => {
  const reload = deferred();
  let reads = 0;
  const items = [negotiation(1, 'Acme site', [term(7, 'Payment terms')]), negotiation(2, 'Birch app')];
  const restore = stub({
    listPartnerNegotiations: () => { reads += 1; return reads === 1 ? Promise.resolve(negBody(items)) : reload.promise; },
    savePartnerNegotiation: async () => ({}),
  });
  const m = await mountContracts(h(PartnerNegotiationsZone));
  const u = ui(m);
  try {
    await m.flush();
    await u.press('Open terms', 0);
    await u.press('Edit');
    await u.type(termBoxes(m)[0], 'Half-typed clause');
    await u.press('Save');
    await m.flush();
    assert.equal(reads, 2);
    assert.equal(u.value(termBoxes(m)[0]), 'Half-typed clause', 'mid-refresh');
    await act(async () => { reload.resolve(negBody(items.map((i) => ({ ...i, terms: i.terms.map((t) => ({ ...t })) })))); });
    await m.flush();
    assert.equal(u.value(termBoxes(m)[0]), 'Half-typed clause', 'after the refresh, even though every term is a new object');
  } finally { await m.unmount(); restore(); }
});

test('Negotiations: a failed new term keeps the new-term form and its text', async () => {
  let fail = true;
  const calls = [];
  const restore = stub({
    listPartnerNegotiations: async () => negBody([negotiation(1, 'Acme site')]),
    createPartnerNegotiationTerm: async (id, body) => { calls.push(body.label); if (fail) throw new Error(RAW); return {}; },
  });
  const m = await mountContracts(h(PartnerNegotiationsZone));
  const u = ui(m);
  try {
    await m.flush();
    await u.press('Open terms');
    const addToggle = m.nodes().find((n) => n.tagName === 'BUTTON' && /^(Add a term|Add term|Add)$/.test(u.textOf(n).trim()) && !m.props(n).disabled);
    await act(async () => { m.props(addToggle).onClick({ stopPropagation() {} }); });
    await u.type(termBoxes(m)[0], 'Liability cap');
    await u.press('Add term');
    await m.flush();
    assert.equal(u.value(termBoxes(m)[0]), 'Liability cap');
    assert.match(m.text(), /That did not save/);
    fail = false;
    await u.press('Add term');
    await m.flush();
    assert.equal(termBoxes(m).length, 0);
    assert.deepEqual(calls, ['Liability cap', 'Liability cap']);
  } finally { await m.unmount(); restore(); }
});

/* ───────────────────────── partner Pipeline · Retainers ───────────────────────── */

const retainerRow = (id, client, amountCents) => ({
  engagement_id: id, client, engagement_title: `${client} retainer`, utilisation_pct: null, current_period: '2026-11', usage: [],
  retainer: { shape: 'retainer', cadence: 'monthly', amount_cents: amountCents, retained_hours: null, renews_at: null, ended_at: null, days_to_renewal: null },
});
const retBody = (items) => ({ items, retainer_count: items.length, shape_counts: {} });
const amountBoxes = (m) => m.nodes().filter((n) => n.tagName === 'INPUT' && m.props(n).placeholder === 'e.g. 8000');

test('Retainers: the mounted Monthly cells use the Worker projection and leave ended amounts absent', async () => {
  const rows = [
    ['Quarterly Co', 'quarterly', 990000, 123400, true],
    ['Monthly Co', 'monthly', 880000, 234500, true],
    ['Ended Co', 'monthly', 770000, 345600, false],
  ].map(([name, cadence, rawAmount, monthly, active], i) => {
    const row = retainerRow(i + 1, name, rawAmount);
    return { ...row, founder_name: name, retainer: { ...row.retainer, cadence, active, monthly_amount_cents: monthly, current_monthly_cents: active ? monthly : null, ended_at: active ? null : '2020-01-01' } };
  });
  const restore = stub({ listPartnerRetainers: async () => retBody(rows) });
  const m = await mountContracts(h(PartnerRetainersZone));
  try {
    await m.flush();
    const u = ui(m);
    const rowText = (name) => {
      const row = m.nodes().find((n) => n.childNodes?.length === 6 && u.textOf(n.childNodes[0]) === name);
      assert.ok(row, `ledger row for ${name}`);
      return u.textOf(row.childNodes[1]);
    };
    assert.match(rowText('Quarterly Co'), /\$1,234\/mo/);
    assert.match(rowText('Monthly Co'), /\$2,345\/mo/);
    assert.match(rowText('Ended Co'), /Not recorded/);
    assert.doesNotMatch(rowText('Ended Co'), /\/mo/);
  } finally { await m.unmount(); restore(); }
});

test('Retainers: saving one row keeps another row’s unsaved amount through the refresh', async () => {
  const reload = deferred();
  let reads = 0;
  const rows = () => [retainerRow(1, 'Acme', 800000), retainerRow(2, 'Birch', 500000)];
  const restore = stub({
    listPartnerRetainers: () => { reads += 1; return reads === 1 ? Promise.resolve(retBody(rows())) : reload.promise; },
    savePartnerRetainer: async () => ({}),
  });
  const m = await mountContracts(h(PartnerRetainersZone));
  const u = ui(m);
  try {
    await m.flush();
    const openers = m.nodes().filter((n) => n.tagName === 'BUTTON' && /Update|Edit|Open|Show/.test(u.textOf(n)));
    assert.ok(openers.length >= 2, 'each row has an opener');
    for (const o of openers.slice(0, 2)) await act(async () => { m.props(o).onClick({ stopPropagation() {} }); });
    assert.equal(amountBoxes(m).length, 2);
    await u.type(amountBoxes(m)[0], '9999');
    await u.press('Save retainer', 1);
    await m.flush();
    assert.equal(reads, 2);
    assert.equal(u.value(amountBoxes(m)[0]), '9999');
    await act(async () => { reload.resolve(retBody(rows())); });
    await m.flush();
    assert.equal(amountBoxes(m).length, 2, 'both editors survived');
    assert.equal(u.value(amountBoxes(m)[0]), '9999', 'row 1 was not reset to its stored 8000');
  } finally { await m.unmount(); restore(); }
});

/**
 * #5934 (D4838 PP08 / PP08m) — the shared opportunity sheet.
 *
 *   · one opportunity is joined by id across Leads, Proposals, Negotiations and Retainers, never by name;
 *   · the header says who, the current stage, the value and the source;
 *   · tabs appear only when their record exists;
 *   · Activity lists recorded events only, and reads Not recorded with none;
 *   · a failed read is Unreadable inside the sheet, with Try again;
 *   · on a phone it is full screen; it takes focus and gives it back;
 *   · a background refresh keeps an open editor and its draft (#4685).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/opportunity_sheet_5934.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, useState } from 'react';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import { LightboxPhoneProvider } from '../src/ui/Lightbox.jsx';
import OpportunitySheet, {
  OPPORTUNITY_TABS, activityRows, currentStage, opportunityTabs, opportunityValue, readOpportunity, resolveOpportunity,
} from '../src/pages/partner/pipeline/OpportunitySheet.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ok = (value) => ({ state: 'ok', value });

const LEAD = {
  need_id: 7, who: 'Verwood', title: 'Merchant onboarding rebuild', budget_min: 15000, budget_max: 20000,
  source: 'marketplace_need', source_label: 'Marketplace need', days_old: 3, score: 81,
  receipts: [{ label: 'Payments · match', kind: 'hit' }, { label: 'No budget floor stated', kind: 'gap' }], excluded_by: null,
};
const PROPOSAL = {
  quote_id: 31, need_id: 7, client: 'Verwood', need_title: 'Merchant onboarding rebuild', price_dollars: 18000,
  state: 'Sent', status: 'submitted', shape: 'Fixed scope', version: 2,
  versions: [{ id: 1, version: 2, change_summary: 'Cut discovery', price_cents: 1800000, created_at: '2026-10-30' }],
  signal: 'Sent · silent 4 days', engagement_id: null,
};
const NEGOTIATION = {
  quote_id: 31, need_id: 7, price: 18000, founder_name: 'Verwood', need_title: 'Merchant onboarding rebuild',
  negotiation: { stage: 'terms', label: 'Terms', ball: 'us', open_question: 'Cancellation period', days_stalled: 4 },
  terms: [{ id: 1, label: 'Cancellation', our_position: '60 days', their_position: '30 days', landing: null, state: 'open' }],
};
// The same client name on another need: never this opportunity.
const DECOY = { quote_id: 99, need_id: 8, client: 'Verwood', need_title: 'Other work', price_dollars: 999, state: 'Won', status: 'accepted', engagement_id: 5 };
const RETAINER = {
  engagement_id: 5, engagement_status: 'active', engagement_price: 999, founder_name: 'Verwood', need_title: 'Other work',
  retainer: { shape: 'retainer', cadence: 'monthly', active: true, current_monthly_cents: 300000 },
};
const EVENTS = [
  { key: 'proposal_version:1', kind: 'proposal_version', occurred_at: '2026-10-30T10:00:00Z' },
  { key: 'mystery:1', kind: 'something_new', occurred_at: '2026-10-29T10:00:00Z' },
];

/** The four zone reads and the activity feed, as stubs. */
function sources({ leads = { items: [LEAD], passed: [] }, proposals = { items: [PROPOSAL, DECOY] },
  negotiations = { items: [NEGOTIATION] }, retainers = { items: [RETAINER] }, activity = { items: [] } } = {}) {
  const calls = [];
  const run = (k, v) => async (arg) => { calls.push([k, arg]); return typeof v === 'function' ? v() : v; };
  return {
    calls,
    leads: run('leads', leads), proposals: run('proposals', proposals), negotiations: run('negotiations', negotiations),
    retainers: run('retainers', retainers), activity: run('activity', activity),
  };
}

const tabNames = (s) => s.nodes().filter((n) => propsOf(n).role === 'tab').map((n) => textOf(n).trim());
const allReads = { leads: ok({ items: [LEAD], passed: [] }), proposals: ok({ items: [PROPOSAL, DECOY] }), negotiations: ok({ items: [NEGOTIATION] }), retainers: ok({ items: [RETAINER] }) };

// Mutation checked: finding the proposal by client name (the decoy's engagement joins in, fails).
test('#5934 PP08: one opportunity is joined by id, never by name', () => {
  const r = resolveOpportunity({ needId: 7 }, allReads);
  assert.equal(r.proposal.quote_id, 31);
  assert.equal(r.negotiation.quote_id, 31);
  assert.equal(r.retainer, null, 'the same client on another need is not this opportunity');
  const fromEngagement = resolveOpportunity({ engagementId: 5 }, allReads);
  assert.equal(fromEngagement.proposal.quote_id, 99, 'an engagement finds its need through its own quote');
  assert.equal(fromEngagement.needId, 8);
  assert.equal(fromEngagement.lead, null);
});

// Mutation checked: every tab always (fails); Terms on a quote with no tracked negotiation (fails).
test('#5934 PP08: tabs appear only when their record exists', () => {
  assert.deepEqual(OPPORTUNITY_TABS, ['Overview', 'Activity', 'Fit', 'Proposal', 'Terms', 'Engagement']);
  assert.deepEqual(opportunityTabs(resolveOpportunity({ needId: 7 }, { ...allReads, proposals: ok({ items: [] }), negotiations: ok({ items: [] }) })),
    ['Overview', 'Activity', 'Fit']);
  assert.deepEqual(opportunityTabs(resolveOpportunity({ needId: 7 }, allReads)), ['Overview', 'Activity', 'Fit', 'Proposal', 'Terms']);
  const untracked = { ...NEGOTIATION, negotiation: null };
  assert.deepEqual(opportunityTabs(resolveOpportunity({ quoteId: 31 }, { ...allReads, leads: ok({ items: [], passed: [] }), negotiations: ok({ items: [untracked] }) })),
    ['Overview', 'Activity', 'Proposal']);
  const engaged = resolveOpportunity({ engagementId: 5 }, allReads);
  assert.deepEqual(opportunityTabs(engaged), ['Overview', 'Activity', 'Proposal', 'Engagement']);
  assert.equal(currentStage(engaged), 'engagement');
  assert.equal(opportunityValue(engaged), '$3,000 a month');
});

test('#5934 PP08: the canvas draws one sheet with a stage tracker across the lifecycle', () => {
  const canvas = read('design/incoming/Pipeline v2 Page.dc.html');
  const sheet = /const oppSheet = \(\) => [^\n]+/.exec(canvas)?.[0] || '';
  for (const stage of ['Lead', 'Proposal', 'Negotiation', 'Retainer']) assert.match(sheet, new RegExp(`>(✓ )?${stage}<`));
  assert.match(canvas, /PP08m: \(\) => phone\(/, 'PP08m is the phone frame');
  assert.match(read('frontend/src/ui/sheet.css'), /max-width: 639\.98px[\s\S]*\.axs-sheet \{ width: 100% !important;/, 'the shared sheet is full width on a phone');
});

// Mutation checked: printing a feed kind this sheet does not know (fails).
test('#5934 PP08: activity is the recorded feed only', () => {
  assert.deepEqual(activityRows(EVENTS).map((e) => e.text), ['Proposal version recorded']);
  assert.deepEqual(activityRows(null), []);
});

test('#5934 PP08: the header says who, the stage, the value and the source', async () => {
  const src = sources();
  const s = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, onClose() {}, sources: src }), { modal: true });
  try {
    await s.flush();
    const header = textOf(s.by('opportunity-sheet-header'));
    assert.match(header, /Opportunity/);
    assert.match(header, /Verwood/);
    assert.match(header, /Negotiation · Terms/);
    assert.equal(textOf(s.by('opportunity-value')), '$18K');
    assert.equal(textOf(s.by('opportunity-source')), 'Marketplace need');
    const steps = s.by('opportunity-stages');
    assert.equal(propsOf(steps)['aria-label'], 'Stage: Negotiation');
    assert.match(textOf(steps), /✓ Lead✓ ProposalNegotiationEngagement/);
    assert.deepEqual(tabNames(s), ['Overview', 'Activity', 'Fit', 'Proposal', 'Terms']);
    assert.deepEqual(src.calls.find(([k]) => k === 'activity'), ['activity', 7], 'the feed is read for this need');
  } finally { await s.unmount(); }
});

// Mutation checked: a "Proposal sent" line drawn from the stage when the feed is empty (fails).
test('#5934 PP08: Activity reads Not recorded with no recorded event, and invents none', async () => {
  const s = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, initialTab: 'Activity', onClose() {}, sources: sources() }), { modal: true });
  try {
    await s.flush();
    const panel = textOf(s.by('opportunity-tab-activity'));
    assert.match(panel, /Not recorded/);
    assert.doesNotMatch(panel, /Proposal|Lead arrived|Moved/);
    assert.ok(!s.by('opportunity-activity'));
  } finally { await s.unmount(); }
  const t = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, initialTab: 'Activity', onClose() {}, sources: sources({ activity: { items: EVENTS } }) }), { modal: true });
  try {
    await t.flush();
    assert.equal(textOf(t.by('opportunity-activity')), 'Oct 30, 2026Proposal version recorded');
  } finally { await t.unmount(); }
});

// Mutation checked: a failed read drawn as "not in your pipeline" (fails); Try again not re-reading (fails).
test('#5934 PP08: a failed read is Unreadable inside the sheet, with Try again', async () => {
  let fail = true;
  const boom = (value) => { if (fail) throw new Error('down'); return value; };
  const src = sources({
    leads: () => boom({ items: [LEAD], passed: [] }), proposals: () => boom({ items: [PROPOSAL] }),
    negotiations: () => boom({ items: [] }), retainers: () => boom({ items: [] }),
  });
  const s = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, onClose() {}, sources: src }), { modal: true });
  try {
    await s.flush();
    const block = s.by('opportunity-unreadable');
    assert.ok(block, 'Unreadable is drawn');
    assert.equal(propsOf(block).role, 'alert');
    assert.match(textOf(block), /Unreadable/);
    assert.ok(s.by('opportunity-sheet'), 'inside the sheet');
    assert.ok(!s.by('opportunity-missing'));
    fail = false;
    await s.click('Try again');
    await s.flush();
    assert.ok(!s.by('opportunity-unreadable'));
    assert.deepEqual(tabNames(s), ['Overview', 'Activity', 'Fit', 'Proposal']);
  } finally { await s.unmount(); }
  // One read down: the rest stands, and the sheet says which read could not answer.
  const t = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, onClose() {}, sources: sources({ negotiations: () => { throw new Error('down'); } }) }), { modal: true });
  try {
    await t.flush();
    assert.match(textOf(t.by('opportunity-partial')), /Negotiations could not be read/);
    assert.match(textOf(t.by('opportunity-partial')), /Try again/);
  } finally { await t.unmount(); }
  await assert.rejects(readOpportunity({ needId: 7 }, sources({
    leads: () => { throw new Error('No partner profile'); }, proposals: () => { throw new Error('x'); },
    negotiations: () => { throw new Error('x'); }, retainers: () => { throw new Error('x'); },
  })), /No partner profile/, 'all four down is a thrown read, so the zone loop says why');
});

// Mutation checked: `phone="sheet"` (fails); focus left on the opener (fails); not returned on close (fails).
test('#5934 PP08m: full screen on a phone, focus moves in and comes back', async () => {
  const s = await mountForm(h(LightboxPhoneProvider, { phone: 'sheet' },
    h(OpportunitySheet, { opportunity: { needId: 7 }, onClose() {}, sources: sources() })), { modal: true, phone: true });
  const opener = s.opener;
  try {
    await s.flush();
    assert.equal(propsOf(s.by('opportunity-sheet-layer'))['data-phone'], 'full', 'a full-screen page, even where a page asks for bottom sheets');
    const dialog = s.by('opportunity-sheet');
    assert.equal(propsOf(dialog).role, 'dialog');
    assert.equal(propsOf(dialog)['aria-modal'], 'true');
    assert.ok(s.doc.activeElement !== opener, 'focus left the opener'); // node identity: a diff of two DOM nodes would not print
    assert.ok(dialog.contains(s.doc.activeElement), 'focus is inside the sheet');
    await s.render(null); // the opener closes it
    assert.ok(s.doc.activeElement === opener, 'focus returns to what opened it');
  } finally { await s.unmount(); }
});

/** A zone's editor with a local draft, as a zone would mount it in a tab. */
function DraftEditor() {
  const [v, setV] = useState('');
  return h('textarea', { 'aria-label': 'Draft', value: v, onChange: (e) => setV(e.target.value) });
}

// Mutation checked: a refresh drawing the skeleton (editor unmounts, fails); a failed refresh dropping the
// Proposal tab (fails).
test('#5934 PP08: a background refresh keeps an open editor and its draft (#4685)', async () => {
  let held = null;
  let fail = false;
  const src = sources({
    proposals: () => {
      if (fail) throw new Error('down');
      if (!held) return { items: [PROPOSAL] };
      return held.promise;
    },
  });
  const props = (refreshKey) => ({ opportunity: { needId: 7 }, initialTab: 'Proposal', refreshKey, onClose() {}, sources: src, editors: { Proposal: h(DraftEditor) } });
  const s = await mountForm(h(OpportunitySheet, props(0)), { modal: true });
  const area = () => s.nodes().find((n) => n.tagName === 'TEXTAREA');
  try {
    await s.flush();
    assert.ok(area(), 'the editor is mounted in its tab');
    await act(async () => { propsOf(area()).onChange({ target: { value: 'v3: drop the audit' } }); });
    const before = area();
    let resolve;
    held = { promise: new Promise((r) => { resolve = r; }) };
    await s.render(h(OpportunitySheet, props(1)));
    await s.flush();
    assert.ok(!s.by('opportunity-loading'), 'no skeleton over an open record');
    assert.ok(area() === before, 'the same editor, still mounted');
    await act(async () => { resolve({ items: [{ ...PROPOSAL, version: 3 }] }); });
    await s.flush();
    assert.ok(area() === before, 'still the same editor');
    assert.equal(propsOf(area()).value, 'v3: drop the audit', 'the draft is kept');
    fail = true;
    await s.render(h(OpportunitySheet, props(2)));
    await s.flush();
    assert.ok(tabNames(s).includes('Proposal'), 'a failed refresh keeps the last good record and its tab');
    assert.equal(propsOf(area()).value, 'v3: drop the audit');
  } finally { await s.unmount(); }
});

// Mutation checked: the hook without `key` (the old record stays on screen, fails).
test('#5934 PP08: pointed at another opportunity, the sheet reads that one afresh', async () => {
  const src = sources();
  const s = await mountForm(h(OpportunitySheet, { opportunity: { needId: 7 }, onClose() {}, sources: src }), { modal: true });
  try {
    await s.flush();
    assert.match(textOf(s.by('opportunity-sheet-header')), /Negotiation · Terms/);
    await s.render(h(OpportunitySheet, { opportunity: { engagementId: 5 }, onClose() {}, sources: src }));
    await s.flush();
    assert.match(textOf(s.by('opportunity-sheet-header')), /Retainer · active/);
    assert.deepEqual(tabNames(s), ['Overview', 'Activity', 'Proposal', 'Engagement']);
    assert.deepEqual(src.calls.filter(([k]) => k === 'activity').map(([, a]) => a), [7, 8]);
  } finally { await s.unmount(); }
});

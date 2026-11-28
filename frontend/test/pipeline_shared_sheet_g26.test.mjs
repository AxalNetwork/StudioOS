/**
 * #9110 (D9110, gap g26, canvas `Pipeline v2` PP-6 / PP08 / PP08m) — the shared opportunity sheet from every zone.
 *
 *   · a Recent movement row carries its need and opens that opportunity's sheet on Activity;
 *   · See all opens the whole recorded feed (up to the Worker's 200) in a sheet on `/pipeline`, and its rows open
 *     the same sheet, one sheet at a time;
 *   · the cap line is decided by the Worker's raw item count, not by the rows drawn;
 *   · Proposals, Negotiations and Retainers each open the same sheet with the id they hold.
 *
 * Every name here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_shared_sheet_g26.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  FEED_ALL_LIMIT, MOVEMENT_SHOWN, activityRows, allMovementView, movementView, ok, unreadable,
} from '../src/pages/partner/pipeline/commandCentre.js';
import { CommandCentre } from '../src/pages/partner/pipeline/PipelineCommandCentre.jsx';
import NegotiationTermsSheet from '../src/pages/partner/pipeline/NegotiationTermsSheet.jsx';
import { readOpportunity } from '../src/pages/partner/pipeline/OpportunitySheet.jsx';

const src = (name) => codeOnly(readFileSync(resolve(process.cwd(), `frontend/src/pages/partner/pipeline/${name}.jsx`), 'utf8'));

const event = (i, kind = 'passed', needId = 40 + i) => ({
  key: `${kind}:${i}`, kind, occurred_at: `2026-11-${String(10 + (i % 15)).padStart(2, '0')}T09:00:00Z`,
  opportunity: needId == null ? null : { need_id: needId, uid: `need-${needId}`, title: `Tideway Works ${i}` },
});

const LEAD = { need_id: 7, who: 'Copperfield Labs', title: 'Billing rebuild', source: 'marketplace_need', source_label: 'Marketplace need', receipts: [] };
const PROPOSAL = {
  quote_id: 31, need_id: 7, client: 'Copperfield Labs', need_title: 'Billing rebuild', price_dollars: 12000,
  state: 'Won', status: 'accepted', shape: 'Fixed scope', version: 1, versions: [], engagement_id: 5,
};
const NEGOTIATION = {
  quote_id: 31, need_id: 7, price: 12000, founder_name: 'Copperfield Labs', need_title: 'Billing rebuild',
  negotiation: { stage: 'terms', label: 'Terms', ball: 'us', open_question: 'Payment days', days_stalled: 2 }, terms: [],
};
const RETAINER = {
  engagement_id: 5, engagement_status: 'active', engagement_price: 12000, founder_name: 'Copperfield Labs', need_title: 'Billing rebuild',
  retainer: { shape: 'retainer', cadence: 'monthly', active: true, current_monthly_cents: 100000 },
};

function opportunitySources() {
  const calls = [];
  const run = (k, v) => async (arg) => { calls.push([k, arg]); return v; };
  return {
    calls,
    leads: run('leads', { items: [LEAD], passed: [] }), proposals: run('proposals', { items: [PROPOSAL] }),
    negotiations: run('negotiations', { items: [NEGOTIATION] }), retainers: run('retainers', { items: [RETAINER] }),
    activity: run('activity', { items: [] }),
  };
}

const viewWith = (movement) => ({ attention: [], metrics: [], lifecycle: [], risks: [], movement });

/* ------------------------------------------------------------------ *
 * The pure rules
 * ------------------------------------------------------------------ */

// Mutation checked: `needId` dropped from `activityRows` (fails); `FEED_ALL_LIMIT` 100 (fails); `movementView`
// unsliced (fails).
test('#9110: a feed row carries its need; the root still shows eight; See all asks for the Worker cap', () => {
  const rows = activityRows([event(1), event(2, 'proposal_won', null)]);
  assert.deepEqual(rows.map((r) => r.needId), [41, null], 'a row keeps its need id, and one without stays null');
  assert.equal(MOVEMENT_SHOWN, 8);
  const many = Array.from({ length: 20 }, (_, i) => event(i));
  assert.equal(movementView(ok({ items: many })).rows.length, 8, 'the root shows the eight latest only');
  assert.equal(FEED_ALL_LIMIT, 200, 'the Worker caps the feed at LIST_PAGE_MAX = 200');
  assert.match(src('PipelineCommandCentre'), /partnerPipelineActivityApi\.list\(\{ limit: FEED_ALL_LIMIT \}\)/);
  assert.match(src('PipelineCommandCentre'), /partnerPipelineActivityApi\.list\(\{ limit: MOVEMENT_SHOWN \}\)/, 'the root read changed');
});

// Mutation checked: `capped` from the drawn rows' length (fails on the 200-with-unknown-kinds page); `>= 199`
// (fails on 199); capped always false (fails).
test('#9110: the cap line is decided by the raw item count, not by the rows drawn', () => {
  const full = Array.from({ length: FEED_ALL_LIMIT }, (_, i) => event(i, i % 4 === 0 ? 'something_new' : 'passed'));
  const v = allMovementView(ok({ items: full }));
  assert.equal(v.state, 'ok');
  assert.equal(v.rows.length, 150, 'unknown kinds are left out of the drawn rows');
  assert.equal(v.capped, true, 'a full page of 200 events is capped, even when fewer rows are drawn');
  const short = allMovementView(ok({ items: full.slice(0, FEED_ALL_LIMIT - 1) }));
  assert.equal(short.capped, false, '199 events are the whole feed');
  assert.deepEqual(allMovementView(unreadable()), { state: 'unreadable' });
  assert.deepEqual(allMovementView({ state: 'loading' }), { state: 'loading' });
  assert.deepEqual(allMovementView(ok({ items: [] })), { state: 'ok', rows: [], capped: false });
});

/* ------------------------------------------------------------------ *
 * The root: a movement row and See all
 * ------------------------------------------------------------------ */

// Mutation checked: the row opening the sheet on Overview (fails); a row with no need drawn as a button (fails);
// the row passing `quoteId` instead of `needId` (fails: the feed is never read for need 41).
test('#9110 PP02: a Recent movement row opens its opportunity sheet on Activity; a row with no need stays text', async () => {
  const opp = opportunitySources();
  const view = viewWith(movementView(ok({ items: [event(1, 'passed', 7), event(2, 'proposal_won', null)] })));
  const s = await mountForm(h(CommandCentre, { view, sheetSources: { opportunity: opp, feed: async () => ({ items: [] }) } }), { modal: true });
  try {
    assert.ok(s.by('pipeline-movement-row-passed:1-open'), 'a row with a need is a button');
    assert.equal(s.by('pipeline-movement-row-proposal_won:2-open'), undefined, 'a row without a need opens nothing');
    assert.match(propsOf(s.by('pipeline-movement-row-passed:1-open')).className, /min-h-\[44px\]/);
    assert.ok(!s.by('opportunity-sheet'));
    const row = s.by('pipeline-movement-row-passed:1-open');
    row.focus();
    await s.click(textOf(row).trim());
    await s.flush();
    assert.ok(s.by('opportunity-sheet'), 'the opportunity sheet opened');
    assert.equal(propsOf(s.by('opportunity-sheet-layer'))['data-phone'], 'full');
    assert.ok(s.by('opportunity-tab-activity'), 'it opens on Activity');
    assert.deepEqual(opp.calls.find(([k]) => k === 'activity'), ['activity', 7], 'the feed is read for this need');
    await s.escape();
    assert.ok(!s.by('opportunity-sheet'), 'Escape closes it');
    assert.ok(s.doc.activeElement === row, 'focus returns to the row');
  } finally { await s.unmount(); }
});

// Mutation checked: See all drawn over an empty feed (fails); the All movement sheet kept open under the
// opportunity sheet (fails); the cap line drawn from rows (fails).
test('#9110: See all lists the whole feed in a sheet, with the cap line, and a row there opens its sheet', async () => {
  const opp = opportunitySources();
  const full = Array.from({ length: FEED_ALL_LIMIT }, (_, i) => event(i, i % 2 ? 'something_new' : 'passed', i === 0 ? 7 : 40 + i));
  const feedCalls = [];
  const feed = async () => { feedCalls.push(1); return { items: full }; };
  const view = viewWith(movementView(ok({ items: full.slice(0, 8) })));
  const s = await mountForm(h(CommandCentre, { view, sheetSources: { opportunity: opp, feed } }), { modal: true });
  try {
    const seeAll = s.by('pipeline-movement-see-all');
    assert.ok(seeAll, 'See all is drawn when the read answered with rows');
    assert.match(propsOf(seeAll).className, /min-h-\[44px\]/);
    seeAll.focus();
    await s.click('See all');
    await s.flush();
    assert.ok(s.by('pipeline-all-movement'), 'the All movement sheet opened');
    assert.match(textOf(s.by('pipeline-all-movement-header')), /All movement/);
    assert.equal(propsOf(s.by('pipeline-all-movement-layer'))['data-phone'], 'full');
    assert.equal(feedCalls.length, 1);
    const list = s.by('pipeline-all-movement-list');
    assert.equal(list.childNodes.length, 100, 'every known event of the page is drawn');
    assert.match(textOf(s.by('pipeline-all-movement-capped')), /^Showing the latest 200 events\./);
    // A row there opens its opportunity; only one sheet is open.
    const row = s.by('pipeline-all-movement-row-passed:0-open');
    await s.click(textOf(row).trim());
    await s.flush();
    assert.ok(!s.by('pipeline-all-movement'), 'All movement closed');
    assert.ok(s.by('opportunity-sheet'), 'the opportunity sheet opened');
    assert.deepEqual(opp.calls.find(([k]) => k === 'activity'), ['activity', 7]);
    await s.escape();
    assert.ok(!s.by('opportunity-sheet'));
    assert.ok(s.doc.activeElement === seeAll, 'focus returns to See all');
  } finally { await s.unmount(); }

  for (const movement of [movementView(ok({ items: [] })), movementView(unreadable())]) {
    const t = await mountForm(h(CommandCentre, { view: viewWith(movement) }), { modal: true });
    try { assert.equal(t.by('pipeline-movement-see-all'), undefined, 'See all over no rows or a failed read'); } finally { await t.unmount(); }
  }
});

// Mutation checked: a failed read drawn as nothing moved (fails); Try again not re-reading (fails); the cap line
// shown under 199 events (fails); the empty line dropped (fails); Try again keeping the Unreadable line (fails).
test('#9110: All movement states — loading, nothing moved, Unreadable with Try again, no cap under a short page', async () => {
  let fail = true;
  let items = [];
  let hold = null;
  const feed = async () => {
    if (hold) await hold.promise;
    if (fail) throw new Error('down');
    return { items };
  };
  const view = viewWith(movementView(ok({ items: [event(1)] })));
  const s = await mountForm(h(CommandCentre, { view, sheetSources: { opportunity: opportunitySources(), feed } }), { modal: true });
  try {
    let release;
    hold = { promise: new Promise((r) => { release = r; }) };
    await s.click('See all');
    assert.ok(s.by('pipeline-all-movement-loading'), 'a skeleton while the feed is read');
    assert.equal(propsOf(s.by('pipeline-all-movement-loading'))['aria-busy'], 'true');
    hold = null;
    release();
    await s.flush();
    const bad = textOf(s.by('pipeline-all-movement-unreadable'));
    assert.match(bad, /Unreadable\. The lifecycle feed could not be read; this is not evidence that nothing moved\./);
    assert.doesNotMatch(s.text(), /Nothing has moved yet/);
    fail = false;
    let again;
    hold = { promise: new Promise((r) => { again = r; }) };
    // Not awaited inside act: the read is held until `again()`.
    await act(async () => { propsOf(s.by('pipeline-all-movement-retry')).onClick(); });
    assert.ok(s.by('pipeline-all-movement-loading'), 'Try again reads afresh, with the skeleton');
    hold = null;
    again();
    await s.flush();
    assert.ok(!s.by('pipeline-all-movement-unreadable'));
    assert.match(textOf(s.by('pipeline-all-movement-none')), /^Nothing has moved yet\. No lead was passed/);
    items = Array.from({ length: FEED_ALL_LIMIT - 1 }, (_, i) => event(i));
    await s.escape();
    await s.click('See all');
    await s.flush();
    assert.equal(s.by('pipeline-all-movement-list').childNodes.length, 199);
    assert.equal(s.by('pipeline-all-movement-capped'), undefined, '199 events are the whole feed: no cap line');
  } finally { await s.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The zones: Open opportunity, with the id each holds
 * ------------------------------------------------------------------ */

// Mutation checked: each zone's id key swapped (quoteId → needId, engagementId → quoteId: fails); the import
// dropped (fails); Negotiations opening on Overview (fails).
test('#9110: Proposals, Negotiations and Retainers open the shared sheet with the id they hold', () => {
  const imports = /import OpportunitySheet(?:, \{[^}]*\})? from '\.\/OpportunitySheet';/;
  for (const zone of ['ProposalsZone', 'NegotiationsZone', 'RetainersZone', 'PipelineCommandCentre']) {
    assert.match(src(zone), imports, `${zone} does not import OpportunitySheet`);
  }
  assert.match(src('ProposalsZone'), /<OpportunitySheet\s+opportunity=\{\{ quoteId: opportunity\?\.quoteId \}\}/);
  assert.match(src('ProposalsZone'), /setOpportunity\(\{ quoteId: r\.quote_id,/);
  assert.match(src('NegotiationsZone'), /<OpportunitySheet\s+opportunity=\{\{ quoteId: opportunity\?\.quoteId \}\}[^>]*initialTab="Terms"/);
  assert.match(src('NegotiationsZone'), /setOpportunity\(\{ quoteId: r\.quote_id,/);
  assert.match(src('RetainersZone'), /<OpportunitySheet\s+opportunity=\{\{ engagementId: opportunity\?\.engagementId \}\}/);
  assert.match(src('RetainersZone'), /setOpportunity\(\{ engagementId: r\.engagement_id,/);
  assert.match(src('PipelineCommandCentre'), /<OpportunitySheet opportunity=\{\{ needId: sheet\.needId \}\}[^>]*initialTab="Activity"/);
  // Each zone's own sheet draws the action and stays: it closes first, so one sheet is open.
  assert.match(src('ProposalsZone'), /data-testid="proposal-open-opportunity"/);
  assert.match(src('ProposalsZone'), /const openOpportunity = useCallback\(\(r\) => \{\s*setSheet\(null\);/);
  assert.match(src('NegotiationsZone'), /onOpenOpportunity=\{\(r\) => \{\s*setSheetFor\(null\);/);
  assert.match(src('RetainersZone'), /const openOpportunity = useCallback\(\(r\) => \{\s*closeSheet\(\);/);
  assert.match(src('RetainersZone'), /data-testid="retainer-open-opportunity"/);
  assert.match(src('RetainersZone'), /backToStudio=\{fromStudio\}/, 'the Studio return link is kept');
});

// Mutation checked: the button calling with no row (fails); drawn without the prop (fails).
test('#9110: the terms sheet draws Open opportunity only when the zone passes it, and hands back its row', async () => {
  const seen = [];
  const props = { row: NEGOTIATION, onClose() {}, busy: false, note: null, onSaveNegotiation() {}, onAddTerm() {}, onSaveTerm() {}, onDeleteTerm() {} };
  const s = await mountForm(h(NegotiationTermsSheet, { ...props, onOpenOpportunity: (r) => seen.push(r.quote_id) }), { modal: true });
  try {
    const btn = s.by('negotiation-open-opportunity');
    assert.ok(btn);
    assert.match(propsOf(btn).className, /min-h-\[44px\]/);
    assert.match(propsOf(btn).className, /dark:/);
    await s.click('Open opportunity');
    assert.deepEqual(seen, [31]);
  } finally { await s.unmount(); }
  const t = await mountForm(h(NegotiationTermsSheet, props), { modal: true });
  try { assert.equal(t.by('negotiation-open-opportunity'), undefined); } finally { await t.unmount(); }
});

// The header and stage tracker match across zones because the join is by id.
test('#9110: the same opportunity resolves alike from a need, a quote and an engagement', async () => {
  const got = [];
  for (const id of [{ needId: 7 }, { quoteId: 31 }, { engagementId: 5 }]) {
    const { record } = await readOpportunity(id, opportunitySources());
    got.push([record.needId, record.proposal?.quote_id, record.negotiation?.quote_id, record.retainer?.engagement_id]);
  }
  assert.deepEqual(got, [[7, 31, 31, 5], [7, 31, 31, 5], [7, 31, 31, 5]]);
});

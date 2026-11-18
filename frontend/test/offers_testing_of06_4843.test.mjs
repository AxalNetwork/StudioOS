/**
 * #4843 part 2 (D4843-p2) — Offers · Product testing redrawn to board OF-06 of the Offers v2 canvas
 * and its phone layout OF-09c: each programme shows its five-step lifecycle (Draft → HQ review →
 * Recruiting → Testing → Complete), its places and dates, and the one next action its state calls
 * for. The empty state is OF-06b's, written around the commercial outcome.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offers_testing_of06_4843.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountZone } from './_offers_4688.mjs';
import TestingZone from '../src/pages/partner/offers/TestingZone.jsx';
import {
  LIFECYCLE, applicantsLine, lifecycleCells, nextStep, programmeOrder, stageLabel, stepOf,
} from '../src/pages/partner/offers/testingLifecycle.js';

const prog = (over = {}) => ({
  uid: 'p1', owner_kind: 'partner', product_name: 'Ledger beta', status: 'draft', logo_key: null,
  places: 8, picked_count: 0, applicant_count: 0, opens_at: null, closes_at: null, testing_starts: null, testing_ends: null,
  review_note: null, ...over,
});

// ------------------------------------------------------------------ the model

test('the lifecycle: seven Worker statuses fold into the board’s five steps', () => {
  assert.deepEqual(LIFECYCLE, ['Draft', 'HQ review', 'Recruiting', 'Testing', 'Complete']);
  const at = (s) => stepOf(s);
  assert.deepEqual(['draft', 'rejected', 'submitted', 'approved', 'open', 'testing', 'closed'].map(at), [0, 0, 1, 1, 2, 3, 4]);
  assert.equal(stepOf('paused'), -1, 'a status the Worker does not send is no step');
  assert.equal(stepOf('constructor'), -1, 'an inherited key is no step');
  assert.equal(stageLabel('rejected'), 'Sent back', 'a sent-back draft is named as such');
  assert.equal(stageLabel('approved'), 'HQ review');
  assert.equal(stageLabel('nope'), 'Unknown status');
  assert.deepEqual(lifecycleCells('open').map((c) => c.state), ['done', 'done', 'current', 'todo', 'todo']);
  assert.deepEqual(lifecycleCells('nope').map((c) => c.state), ['todo', 'todo', 'todo', 'todo', 'todo']);
});

test('the next action follows the state, and the waiting states offer none', () => {
  const step = (over) => nextStep(prog(over));
  assert.deepEqual([step({}).action, step({}).label, step({}).primary], ['submit', 'Submit for approval', true]);
  assert.deepEqual([step({ owner_kind: 'hq' }).action], [null], 'HQ’s own draft is not submitted for approval');
  const back = step({ status: 'rejected', review_note: 'Add the dates' });
  assert.deepEqual([back.action, back.label, back.line], ['edit', 'Edit and resubmit', 'HQ: Add the dates']);
  assert.equal(step({ status: 'rejected' }).line, 'HQ sent it back without a note.');
  for (const s of ['submitted', 'approved']) {
    assert.deepEqual([step({ status: s }).title, step({ status: s }).action], ['Waiting for HQ', null], s);
  }
  assert.deepEqual([step({ status: 'open' }).label, step({ status: 'open' }).action], ['Review applicants', 'applicants']);
  assert.deepEqual([step({ status: 'testing', picked_count: 1 }).label, step({ status: 'testing', picked_count: 1 }).title], ['Continue testing', '1 tester testing']);
  const done = step({ status: 'closed', picked_count: 5 });
  assert.deepEqual([done.title, done.label, done.primary, done.line], ['Complete', 'View testers', false, '5 testers took part.']);
  assert.equal(step({ status: 'nope' }).action, null);
});

test('applicants are counted as the read counts them, never as "need review"', () => {
  assert.equal(applicantsLine(prog({ applicant_count: 3, picked_count: 1 })), '3 applicants · 1 picked');
  assert.equal(applicantsLine(prog({ applicant_count: 1, picked_count: 0 })), '1 applicant · 0 picked');
  assert.equal(applicantsLine(prog()), 'No applicants yet');
  assert.equal(applicantsLine(prog({ applicant_count: -2 })), 'No applicants yet');
  assert.equal(nextStep(prog({ status: 'open', applicant_count: 3, picked_count: 1 })).title, '3 applicants · 1 picked');
});

test('the order: the owner’s work first, then by step, then by name', () => {
  const list = [
    prog({ uid: 'c', product_name: 'C', status: 'closed' }), prog({ uid: 's', product_name: 'S', status: 'submitted' }),
    prog({ uid: 'o', product_name: 'O', status: 'open' }), prog({ uid: 'd2', product_name: 'B', status: 'draft' }),
    prog({ uid: 'd1', product_name: 'A', status: 'draft' }), prog({ uid: 'r', product_name: 'R', status: 'rejected' }),
  ];
  assert.deepEqual(programmeOrder(list).map((p) => p.uid), ['r', 'd1', 'd2', 'o', 's', 'c']);
  assert.deepEqual(list.map((p) => p.uid), ['c', 's', 'o', 'd2', 'd1', 'r'], 'the read’s own list is left as it came');
  assert.deepEqual(programmeOrder(null), []);
});

// ------------------------------------------------------------------ mounted

function api(items) {
  const calls = [];
  return {
    calls,
    programmes: async () => ({ items: items.map((p) => ({ ...p })) }),
    submit: async (uid) => { calls.push(['submit', uid]); return {}; },
    applicants: async () => ({ programme: items[0], items: [] }),
    pick: async () => ({}), decline: async () => ({}),
  };
}
async function mounted(items) {
  const a = api(items);
  const v = await mountZone(() => h(TestingZone, { api: a }));
  await v.flush();
  return { v, a };
}
const byId = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);

test('mounted: one card per programme with its lifecycle, places and dates, and one next action', async () => {
  const { v, a } = await mounted([
    prog({ uid: 'o', product_name: 'Founder onboarding pilot', status: 'open', places: 8, picked_count: 5, applicant_count: 7, opens_at: '2026-11-10', closes_at: '2026-12-08' }),
    prog({ uid: 'd', product_name: 'Pricing calculator beta', places: 12 }),
    prog({ uid: 's', product_name: 'Investor CRM integration', status: 'submitted', places: 6 }),
    prog({ uid: 'c', product_name: 'Board-pack template test', status: 'closed', places: 5, picked_count: 5, applicant_count: 5 }),
  ]);
  try {
    assert.match(v.text(), /Product testing/);
    assert.match(v.text(), /Recruit Axal members to test your product before launch\./);
    assert.ok(v.has('+ New programme'), 'the one header action');
    assert.equal(v.props(byId(v, 'testing-life-o'))['aria-label'], 'Lifecycle: Recruiting');
    assert.match(v.textIn('testing-life-o'), /✓ Draft.*✓ HQ review.*Recruiting.*Testing.*Complete/s);
    assert.match(v.textIn('testing-meta-o'), /5 of 8 places filled · Applications 10 Nov – 8 Dec/);
    assert.match(v.textIn('testing-next-o'), /7 applicants · 5 picked.*Review applicants/s);
    assert.match(v.textIn('testing-next-d'), /Waiting for you.*Submit for approval/s);
    assert.match(v.textIn('testing-next-s'), /Waiting for HQ/);
    assert.equal(byId(v, 'testing-open-s'), undefined, 'waiting for HQ offers no button');
    assert.equal(byId(v, 'testing-submit-s'), undefined);
    assert.match(v.textIn('testing-next-c'), /Complete.*5 testers took part\..*View testers/s);
    assert.doesNotMatch(v.text(), /need review|View results/, 'nothing the read cannot say');
    // The owner's work is listed first.
    const order = v.nodes().filter((n) => /^testing-programme-/.test(v.props(n)?.['data-testid'] || '')).map((n) => v.props(n)['data-testid']);
    assert.deepEqual(order, ['testing-programme-d', 'testing-programme-o', 'testing-programme-s', 'testing-programme-c']);
    // Submit for approval sends it.
    await act(async () => { await v.props(byId(v, 'testing-submit-d')).onClick(); });
    assert.deepEqual(a.calls, [['submit', 'd']]);
  } finally { await v.unmount(); }
});

test('mounted: Review applicants opens that programme’s applicants; a sent-back draft offers Edit and resubmit', async () => {
  const { v } = await mounted([
    prog({ uid: 'o', status: 'open', applicant_count: 2 }),
    prog({ uid: 'r', product_name: 'Payroll beta', status: 'rejected', review_note: 'Add the dates' }),
  ]);
  try {
    assert.equal(v.textIn('testing-edit-r'), 'Edit and resubmit');
    assert.equal(v.textIn('testing-review-note-r'), 'HQ: Add the dates');
    assert.equal(byId(v, 'testing-submit-r'), undefined, 'not resubmitted as it stands');
    await act(async () => { v.props(byId(v, 'testing-edit-r')).onClick(); });
    assert.match(v.text(), /Edit Payroll beta/, 'the edit sheet opens');
  } finally { await v.unmount(); }
  const again = await mounted([prog({ uid: 'o', product_name: 'Pilot', status: 'open', applicant_count: 2 })]);
  try {
    await act(async () => { again.v.props(byId(again.v, 'testing-open-o')).onClick(); });
    await again.v.flush();
    assert.match(again.v.text(), /Applicants/, 'the applicants sheet opens');
  } finally { await again.v.unmount(); }
});

test('mounted: on a phone the lifecycle folds to its stage pill and the next action is full width', async () => {
  const { v } = await mounted([prog({ uid: 'o', status: 'open', applicant_count: 3 })]);
  try {
    assert.match(v.props(byId(v, 'testing-life-o')).className, /hidden[^]*sm:flex/, 'the strip is the desk’s');
    assert.match(v.textIn('testing-stage-o'), /Recruiting/);
    assert.match(v.props(byId(v, 'testing-stage-o')).className, /sm:hidden/, 'the stage pill is the phone’s');
    assert.match(v.props(byId(v, 'testing-open-o')).className, /min-h-\[48px\][^]*w-full/, 'a 48px, full-width target on a phone');
  } finally { await v.unmount(); }
});

test('mounted: the empty state is written around the outcome, with one action', async () => {
  const { v } = await mounted([]);
  try {
    assert.match(v.text(), /Validate an offer before launch/);
    assert.match(v.text(), /Recruit Axal members to test your product and give feedback\./);
    assert.ok(v.has('Create a testing programme'));
    assert.ok(!v.has('+ New programme'), 'one action, not two');
  } finally { await v.unmount(); }
});

test('the part file names the board, the fold and what the read cannot say', () => {
  const f = 'documentation/architecture/decisions/D4843-p2.md';
  assert.ok(existsSync(f));
  const d = readFileSync(f, 'utf8');
  assert.match(d, /^## D4843 part 2 — .*\(#4843\)$/m);
  for (const s of ['OF-06', 'OF-09c', 'HQ review', 'Recruiting', 'View testers', 'need review']) assert.ok(d.includes(s), s);
});

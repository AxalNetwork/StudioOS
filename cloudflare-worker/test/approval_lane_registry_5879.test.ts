/**
 * D5879 (#5879, package 6 of #4716) — one registry of approval-lane facts.
 *
 *   · every lane key states its group, scope, notice, destination (or why
 *     nothing decides it) and decision-history capability;
 *   · the inbox sources, `LANE_GROUP`, the decision log and its labels are
 *     read from the registry, in its order, and agree with it;
 *   · a lane that records its decisions is never unrecorded in the Decided
 *     model, and the helpers refuse a lane the registry does not describe.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/approval_lane_registry_5879.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVAL_LANES, APPROVAL_LANE_KEYS, INBOX_GROUPS, LANE_SCOPES,
  hqSource, laneFacts, recordedLane, studioSource, unrecordedLane,
} from '../src/services/approvalLaneRegistry.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { LANE_GROUP } from '../src/services/approvalInbox.ts';
import { DECISION_LANES, decisionLanesFor, laneLabel } from '../src/services/approvalDecisions.ts';

const SOURCES = [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

test('every lane key has a group, a scope, a notice, a destination or an undecided reason, and a decision-history entry', () => {
  const problems: string[] = [];
  for (const key of APPROVAL_LANE_KEYS) {
    const f: any = APPROVAL_LANES[key];
    if (!text(f.label)) problems.push(`${key}: no label`);
    if (!(INBOX_GROUPS as readonly string[]).includes(f.group)) problems.push(`${key}: group ${f.group}`);
    if (!(LANE_SCOPES as readonly string[]).includes(f.scope)) problems.push(`${key}: scope ${f.scope}`);
    if (!text(f.notifies)) problems.push(`${key}: no notice`);
    if (f.decidedOn === null) {
      if (!text(f.undecidedReason)) problems.push(`${key}: nothing decides it and no reason says why`);
    } else if (!text(f.decidedOn)) problems.push(`${key}: decidedOn ${f.decidedOn}`);
    if (f.decisionPath !== undefined && !/^\/admin\//.test(f.decisionPath)) problems.push(`${key}: decisionPath ${f.decisionPath}`);
    const d = f.decisions;
    if (!d || typeof d.recorded !== 'boolean') problems.push(`${key}: no decision-history entry`);
    else if (d.recorded) {
      if (!(d.since === null || DAY.test(d.since))) problems.push(`${key}: since ${d.since}`);
      if ('reason' in d) problems.push(`${key}: recorded, with an unrecorded reason`);
    } else if (!text(d.reason)) problems.push(`${key}: unrecorded with no reason`);
  }
  assert.deepEqual(problems, []);
});

test('HQ scope, the hq group and an HQ source are the same lanes', () => {
  for (const key of APPROVAL_LANE_KEYS) {
    const f = APPROVAL_LANES[key];
    assert.equal(f.group === 'hq', f.scope === 'hq', `${key}: group ${f.group}, scope ${f.scope}`);
  }
  assert.deepEqual(HQ_APPROVAL_SOURCES.map((s) => s.key), APPROVAL_LANE_KEYS.filter((k) => APPROVAL_LANES[k].scope === 'hq'));
  assert.deepEqual(APPROVAL_SOURCES.map((s) => s.key), APPROVAL_LANE_KEYS.filter((k) => APPROVAL_LANES[k].scope === 'studio'));
});

test('the inbox sources read their facts from the registry, in its order', () => {
  assert.deepEqual(SOURCES.map((s) => s.key), APPROVAL_LANE_KEYS);
  for (const s of SOURCES) {
    const f = laneFacts(s.key);
    assert.equal(s.label, f.label, s.key);
    assert.equal(s.notifies, f.notifies, s.key);
    assert.equal(s.decidedOn, f.decidedOn, s.key);
    assert.equal(s.decisionPath, f.decisionPath, s.key);
    assert.equal(s.undecidedReason, f.undecidedReason, s.key);
    // Studio lanes carry no scope at all, as before: only HQ's say `hq`.
    assert.equal(s.scope, f.scope === 'hq' ? 'hq' : undefined, s.key);
  }
});

test('LANE_GROUP is the registry\'s groups, nothing written twice', () => {
  assert.deepEqual(Object.keys(LANE_GROUP), APPROVAL_LANE_KEYS);
  for (const key of APPROVAL_LANE_KEYS) assert.equal(LANE_GROUP[key], APPROVAL_LANES[key].group, key);
});

test('the decision log lists the registry\'s lanes, in its order, with its capability', () => {
  assert.deepEqual(DECISION_LANES.map((l) => l.key), APPROVAL_LANE_KEYS);
  for (const l of DECISION_LANES) {
    const d = laneFacts(l.key as any).decisions;
    // A lane that records its decisions is never unrecorded in the Decided model, nor the other way round.
    assert.equal(l.recorded, d.recorded, `${l.key}: Decided says ${l.recorded ? '' : 'not '}recorded`);
    if (l.recorded && d.recorded) {
      assert.equal(l.since, d.since, l.key);
      assert.equal(l.caveat, d.caveat, l.key);
      assert.ok(text(l.sql), `${l.key} is recorded but has no query`);
    }
    if (!l.recorded && !d.recorded) assert.equal(l.reason, d.reason, l.key);
    assert.equal(l.scope, laneFacts(l.key as any).scope === 'hq' ? 'hq' : undefined, l.key);
    assert.equal(laneLabel(l.key), laneFacts(l.key as any).label, l.key);
  }
  // HQ's lanes stay a Super Admin's on Decided, as on the inbox (D1040).
  assert.deepEqual(decisionLanesFor(false).map((l) => l.key), APPROVAL_SOURCES.map((s) => s.key));
});

test('the helpers refuse a lane the registry does not describe', () => {
  assert.throws(() => laneFacts('not_a_lane' as any), /not_a_lane has no entry/);
  assert.throws(() => studioSource('payouts'), /payouts is not a studio lane/);
  assert.throws(() => hqSource('lp' as any), /lp is not an HQ lane/);
  assert.throws(() => recordedLane('jobs'), /jobs does not record/);
  assert.throws(() => unrecordedLane('lp'), /lp records its decisions/);
  assert.equal(laneLabel('not_a_lane'), 'not_a_lane');
});

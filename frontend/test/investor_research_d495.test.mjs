/**
 * D495 (#1023, the Research PR): the investor Research family built up to the
 * owner's line. Each op or zone that waits on something names what it waits
 * on: an owner decision asked on #1023, or a route that is another slot's.
 * Nothing is invented in its place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import { storeGapFor } from '../src/workspaces/noStoreCopy.js';

const op = (zone, label) => investorZoneActions(zone).find((a) => a.label === label);

test('IR1 Clear history is held on the owner’s decision, not presented as one', () => {
  const clear = op('research/ask', 'Clear history');
  assert.equal(clear.disabled, true, 'Clear history can be pressed');
  assert.equal(clear.onClick, undefined);
  assert.match(clear.title, /not decided yet/);
  assert.match(clear.title, /Nothing has been deleted/);
  assert.doesNotMatch(clear.title, /declines|irreversible/, 'an undecided refusal is still worded as policy');
});

test('IR2 New request says it waits on the deal routes, which are slot S02’s', () => {
  const a = op('research/diligence', 'New request');
  assert.equal(a.disabled, true, 'New request can be pressed');
  assert.match(a.title, /deal.*routes \(slot S02\)/, 'New request does not say what it waits on');
});

test('IR2 Attach to deal: D6266 shows each room’s deal by itself, so there is nothing to attach by hand', () => {
  const a = op('research/diligence', 'Attach to deal');
  assert.equal(a.disabled, true, 'Attach to deal can be pressed');
  assert.match(a.title, /already shows its deal/);
});

test('IR4: the investor’s Markets zone states that theses wait on a decision', () => {
  const gap = storeGapFor('markets', 'investor');
  assert.equal(gap.blocks, 'a thesis');
  assert.equal(gap.eyebrow, 'Blocked on a decision');
  assert.match(gap.why, /owner’s decision, asked on #1023/);
  assert.match(gap.why, /nothing here invents one/);
  // The founder's canvas draws a saved analysis, not theses, and keeps its own entry.
  assert.equal(storeGapFor('markets', 'founder').blocks, 'a saved market analysis');
});

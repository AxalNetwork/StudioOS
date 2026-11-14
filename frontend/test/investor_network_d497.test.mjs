/**
 * D497 (#1023, the Network PR): the investor Network family built up to the
 * owner's line. IN1 Add person (question 7) and IN2 Offer one each wait on an
 * owner decision, and each control says so; neither can be pressed. IN3
 * Organizations (question 8) was answered by D572 part 3 and is read since
 * D6258: its chips are pinned in `investor_network_organizations_6258.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';

const op = (zone, label) => investorZoneActions(zone).find((a) => a.label === label);

test('IN1 Add person and IN2 Offer one are held, and say their decision is open', () => {
  const add = op('network/relationships', 'Add person');
  assert.equal(add.disabled, true);
  assert.match(add.title, /not decided yet/);
  assert.match(add.title, /without a user directory/);
  const offer = op('network/introductions', 'Offer one');
  assert.equal(offer.disabled, true);
  assert.match(offer.title, /not decided yet/);
});

test('IN3 Organizations: the two ops stay held, and say why the counterpart’s company is not theirs to edit (D6258)', () => {
  // D497 held these on #1023's question 8. D572 part 3 answered where an
  // organisation lives (the counterpart's own linked company) and D6258 reads
  // it, so the reasons now name that source rather than an open decision.
  const add = op('network/organizations', 'Add org');
  assert.equal(add.disabled, true, 'Add org can be pressed');
  assert.match(add.title, /links their own company on their account/);
  const merge = op('network/organizations', 'Merge duplicates');
  assert.equal(merge.disabled, true, 'Merge duplicates can be pressed');
  assert.match(merge.title, /same name are already one entry/);
  for (const a of [add, merge]) {
    assert.doesNotMatch(a.title, /#1023|not decided|empty on every account/, `${a.label} still says the list cannot exist`);
  }
});

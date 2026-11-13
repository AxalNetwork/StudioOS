/**
 * D497 (#1023, the Network PR): the investor Network family built up to the
 * owner's line. IN1 Add person (question 7), IN2 Offer one and IN3
 * Organizations (question 8) each wait on an owner decision, and each control
 * says so; none can be pressed or selected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import { investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';

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

test('IN3 Organizations: the two ops and the org chips say where an organisation lives is not decided', () => {
  for (const label of ['Add org', 'Merge duplicates']) {
    const a = op('network/organizations', label);
    assert.equal(a.disabled, true, `${label} can be pressed`);
    assert.match(a.title, /not decided/, `${label} does not say its decision is open`);
  }
  const chips = investorZoneFilters('network/organizations', { value: 'all', onChange: () => {} });
  for (const label of ['All', 'Portfolio', 'Co-investors']) {
    const c = chips.find((x) => x.label === label);
    assert.equal(c.disabled, true, `${label} can be selected`);
    assert.match(c.title, /owner’s decision, asked on #1023/, `${label} does not name the decision`);
  }
});

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

// D6272 (#6272): IR1 is no longer held. The owner answered #6274 question 4
// with B (hide, do not delete), so Clear history is a page handler, and with
// no page to supply one it draws nothing rather than a dead control.
test('IR1 Clear history is the page’s handler, not a note citing closed #1023', () => {
  assert.equal(op('research/ask', 'Clear history'), undefined, 'drawn without a page handler');
  let pressed = 0;
  const clear = investorZoneActions('research/ask', { handlers: { clearHistory: () => { pressed += 1; } } })
    .find((a) => a.label === 'Clear history');
  assert.equal(clear.disabled, false);
  clear.onClick();
  assert.equal(pressed, 1);
  assert.doesNotMatch(String(clear.title || ''), /#1023|not decided/);
});

// D6272: the request shipped on the deal (its Documents tab, Ask for access),
// so neither row may say it waits on another slot's routes.
test('IR2 New request and Attach to deal point at the deal, not at slot S02', () => {
  for (const label of ['New request', 'Attach to deal']) {
    const a = op('research/diligence', label);
    assert.equal(a.disabled, true, `${label} can be pressed`);
    assert.doesNotMatch(a.title, /slot S02|research\.ts/, `${label} still cites the old wait`);
  }
  assert.match(op('research/diligence', 'New request').title, /deal’s Documents tab/);
  assert.match(op('research/diligence', 'Attach to deal').title, /already shows its deal/);
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

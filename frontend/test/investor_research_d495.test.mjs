/**
 * D495 (#1023, the Research PR): the investor Research family built up to the
 * owner's line. Each op or zone that waits on something names what it waits
 * on: an owner decision asked on #1023, or a route that is another slot's.
 * Nothing is invented in its place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { investorZoneActions, INVESTOR_ZONE_ACTIONS } from '../src/workspaces/investorZoneActions.js';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';
import * as noStoreCopy from '../src/workspaces/noStoreCopy.js';

const { storeGapFor } = noStoreCopy;

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
// so neither row may say it waits on another slot's routes. D6269 (#6269):
// `New request` is withheld rather than drawn disabled; the room list has no
// one deal to ask on, and the Requests block lists what came of yours.
test('IR2 New request is withheld and Attach to deal points at the deal, not at slot S02', () => {
  assert.equal(op('research/diligence', 'New request'), undefined, 'New request is drawn again');
  const a = op('research/diligence', 'Attach to deal');
  assert.equal(a.disabled, true, 'Attach to deal can be pressed');
  assert.doesNotMatch(a.title, /slot S02|research\.ts|#\d+/, 'Attach to deal cites a wait or an issue');
  assert.match(a.title, /already shows its deal/);
});

// D6274 (#6274): #1023 closed with question 5 unanswered; it was asked again
// on #6274 and the owner answered 5 A (a thesis is the investor's own). The
// card now states that answer and is blocked on the unbuilt store, not on a
// decision.
test('IR4: the investor’s Markets zone states the owner’s thesis answer and the missing store', () => {
  const gap = storeGapFor('markets', 'investor');
  assert.equal(gap.blocks, 'a thesis');
  assert.equal(gap.eyebrow, 'Blocked on a store');
  assert.match(gap.why, /a thesis is yours, not your firm’s \(#6274\)/);
  assert.match(gap.why, /not built yet/);
  assert.match(gap.why, /nothing here invents one/);
  assert.doesNotMatch(gap.why, /owner’s decision, asked on/);
  // The founder's canvas draws a saved analysis, not theses, and keeps its own entry.
  assert.equal(storeGapFor('markets', 'founder').blocks, 'a saved market analysis');
});

// D6274: no string these three modules hand to the screen may cite closed
// #1023. Code comments are not read, only the exported data a zone renders.
function strings(value, out = [], seen = new Set()) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of value instanceof Set ? [...value] : Object.values(value)) strings(v, out, seen);
  }
  return out;
}

test('no customer-facing string in the investor zone copy cites closed #1023', () => {
  const sources = {
    noStoreCopy: Object.fromEntries(Object.entries(noStoreCopy).filter(([, v]) => typeof v !== 'function')),
    INVESTOR_ZONE_ACTIONS,
    INVESTOR_ZONE_FILTERS,
  };
  for (const [name, value] of Object.entries(sources)) {
    const all = strings(value);
    assert.ok(all.length > 0, `${name} exported no strings to check`);
    for (const text of all) assert.doesNotMatch(text, /#1023\b/, `${name} cites #1023: ${text}`);
  }
});

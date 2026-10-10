import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
test('the pitch editor opens on the venture a link names', () => {
  // The A4 desk that seeded this handoff is retired (D661, #1474); a link
  // that names the venture in `?project_id=` still opens the editor on it.
  const editor = read('frontend/src/pages/PitchDeckPage.jsx');
  assert.match(editor, /Number\(searchParams\.get\('project_id'\)\)/);
});

test('a per-share price is not rendered by the whole-dollar formatter', () => {
  // Found by rendering FR3's new 409A panel: a real fair market value of $0.31
  // printed as "$0", because `money()` carries maximumFractionDigits: 0. It is
  // the right formatter for a cap, a SAFE and a payout and the wrong one for a
  // share price — and this particular share price is what an option strike is
  // set from, so a figure rounded away is not a rounded figure, it is a
  // different one. `perShare()` exists to keep them apart.
  const capital = read('frontend/src/pages/founder/FounderRaiseCapital.jsx');
  assert.match(capital, /const perShare = /, 'the per-share formatter is gone');
  assert.match(capital, /minimumFractionDigits: 2, maximumFractionDigits: 4/);
  assert.match(capital, /fair_market_value != null \? perShare\(/,
    'the 409A fair market value is back on the whole-dollar formatter');
  assert.doesNotMatch(capital, /fair_market_value != null \? money\(/);
});

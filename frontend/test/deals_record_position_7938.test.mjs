/**
 * D6889 part 2 (#7938, canvas D6158 DX23 A) — Record position from a closing
 * line: on a closed closing, an Admin's received line that is Not in Portfolio
 * opens the Portfolio form filled in from the line, the saved position names
 * the line (`closing_line_uid`), and the form returns to the closing, where
 * the line reads In Portfolio. The Worker refuses a line that is not received
 * or already has a position (cloudflare-worker/test/closings_d1215.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { portfolioRows, positionPrefill } from '../src/pages/investor/deals/closingWorkspaceModel.js';

const read = (rel) => readFileSync(rel, 'utf8');
const WS = codeOnly(read('frontend/src/pages/investor/deals/ClosingWorkspace.jsx'));
const PAGE = codeOnly(read('frontend/src/pages/PortfolioPositionsPage.jsx'));

const received = (uid, extra = {}) => ({
  uid, status: 'received', investor_name: `Investor ${uid}`, route: 'direct', amount_cents: 2500050, currency: 'USD',
  evidence: [{ side: 'receiving', accepted_at: '2026-11-12T10:00:00Z', created_at: '2026-11-11T09:00:00Z' }],
  in_portfolio: false, ...extra,
});
const closed = (lines, extra = {}) => ({ status: 'closed', project_id: 42, round_label: 'Seed', currency: 'USD', lines, ...extra });

test('a received line Not in Portfolio carries the venture, round, amount received, day received and its own uid', () => {
  const { rows } = portfolioRows(closed([received('l1')]));
  assert.deepEqual(rows[0].prefill, {
    project_id: 42, round_name: 'Seed', invested_amount: '25000.50', position_date: '2026-11-12',
    closing_line_uid: 'l1', line_label: 'Investor l1', amount_cents: 2500050, currency: 'USD',
  });
});

test('a line already in Portfolio, one not received, or a closing with no venture offers no prefill', () => {
  const { rows } = portfolioRows(closed([received('in', { in_portfolio: true, portfolio_position_uid: 'p1' }), received('out')]));
  assert.equal(rows.find((r) => r.uid === 'in').prefill, null);
  assert.ok(rows.find((r) => r.uid === 'out').prefill);
  assert.equal(positionPrefill(closed([]), received('x', { status: 'sent' })), null);
  assert.equal(positionPrefill(closed([], { project_id: null }), received('x')), null);
  assert.equal(positionPrefill(null, received('x')), null);
});

test('the form records dollars: a line in another currency hands no amount, and a missing round or day stays empty', () => {
  const eur = positionPrefill(closed([]), received('e', { currency: 'EUR' }));
  assert.equal(eur.invested_amount, '');
  assert.deepEqual([eur.amount_cents, eur.currency], [2500050, 'EUR'], 'the amount travels as a label');
  const bare = positionPrefill(closed([], { round_label: null }), received('b', { evidence: [] }));
  assert.deepEqual([bare.round_name, bare.position_date], ['', ''], 'never a guessed round or date');
  assert.notEqual(bare.round_name, 'Not recorded');
});

test('Record position is an Admin action on a line Not in Portfolio, and opens the Portfolio form with the prefill and a way back', () => {
  assert.match(WS, /isAdmin && !r\.inPortfolio && r\.prefill \?/);
  assert.match(WS, /<Link to="\/portfolio\/positions" state=\{\{ prefill: \{ \.\.\.r\.prefill, return_to: back \} \}\}/);
  assert.match(WS, />Record position</);
  assert.match(WS, /min-h-\[44px\]/, 'a 44px target on a phone');
});

test('the Portfolio form saves the line it came from, and goes back to the closing once saved', () => {
  assert.match(PAGE, /closing_line_uid: fromLine\?\.uid \|\| undefined/);
  assert.match(PAGE, /if \(back\) \{ navigate\(back\); return; \}/);
  assert.match(PAGE, /p\.return_to\.startsWith\('\/'\)/, 'only an in-app path is followed back');
  assert.match(PAGE, /data-testid="position-from-line"/);
  // A refused save shows the Worker's sentence, as every save on this page does.
  assert.match(PAGE, /catch \(e2\) \{ setErr\(e2\.message \|\| 'Failed to record'\); \}/);
});

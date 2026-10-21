/**
 * D840 part 2 (#2347) — each Raise module's "From Mercury" part.
 *
 * What this pins:
 *   - every Raise module draws the part from `parts.mercury`, and none draws
 *     it when the read carries none (only the founder's own read does);
 *   - a figure says where it came from, and a figure Mercury did not give is
 *     Not recorded, never $0;
 *   - a proposal shows Accept and Dismiss, and a mapping its section choice;
 *   - the client's four calls are the Worker's routes.
 * The Worker's half is cloudflare-worker/test/mercury_raise_feeds_d840.test.ts.
 * Every figure here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_raise_feeds_d840.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MercuryRaiseFeed from '../src/pages/cycles/MercuryRaiseFeed.jsx';
import { figureText, isEmptyView, mercuryView, usd } from '../src/pages/cycles/mercuryRaise.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTE = read('frontend/src/pages/cycles/CycleRoute.jsx');
const WRITES = read('frontend/src/lib/api/cycleWrites.js');
const WORKER = read('cloudflare-worker/src/routes/cycle_raise.ts');
const render = (props) => renderToStaticMarkup(h(MercuryRaiseFeed, { projectId: 101, ...props }));
const SLUGS = ['fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships'];

test('every Raise module draws From Mercury from its read, and nothing without the part', () => {
  // Mutations checked: the part map dropped for a module; the part drawn with no `parts.mercury`.
  assert.match(ROUTE, /MODULES\.raise\.map\(\(m\) => \[m\.slug, \(data, ctx\) => mercuryPart\(m\.slug, data, ctx\)\]\)/);
  assert.match(ROUTE, /\{mercuryPart\('capital-relationships', data, ctx\)\}/, 'beside the calls and the receipt matches');
  assert.match(ROUTE, /part=\{data\?\.parts\?\.mercury\}/);
  for (const slug of SLUGS) assert.equal(render({ slug, part: undefined }), '', slug);
});

test('a figure names its source; one Mercury did not give is Not recorded, never $0', () => {
  // Mutations checked: null read as 0; the source dropped; a percent without its sign.
  assert.equal(usd(null), 'Not recorded');
  assert.equal(usd(1234567), '$12,346');
  assert.equal(figureText({ unit: 'percent', value: 50 }), '+50%');
  assert.equal(figureText({ unit: 'months', value: 6.1 }), '6.1 months');
  assert.equal(figureText({ unit: 'cents', value: null }), 'Not recorded');
  const html = render({ slug: 'fundraising-readiness', part: { runway: { fact_id: 9, label: 'Runway: 6.1 months at the last 3 months’ burn', source: 'From Mercury, as of 2026-10-21', replaces: 'Replaces the runway you recorded in the metrics snapshot of 2026-08-01' } } });
  assert.match(html, /Runway: 6\.1 months/);
  assert.match(html, /Replaces the runway you recorded in the metrics snapshot of 2026-08-01/);
  assert.match(html, /Measured · From Mercury, as of 2026-10-21/);
  assert.match(html, /data-testid="mercury-fact-delete-9"/);
  const deck = render({ slug: 'pitch-deck', part: { figures: [{ key: 'revenue_growth', label: 'Revenue growth', value: null, unit: 'percent', source: 'From Mercury, as of 2026-10-21' }] } });
  assert.match(deck, /Revenue growth: <strong>Not recorded<\/strong>/);
  assert.match(deck, /Figures you can cite/);
});

test('each proposal shows Accept and Dismiss; a mapping its section; an unreadable part says so', () => {
  // Mutations checked: Accept dropped; the section select dropped; the statements' access note dropped; Unreadable shown as empty.
  const funds = render({ slug: 'use-of-funds', part: { categories: [], proposals: [{ id: 3, category: 'Software', section: 'infrastructure', section_label: 'Infrastructure & data' }] } });
  assert.match(funds, /Count Software under Infrastructure &amp; data/);
  assert.match(funds, /data-testid="mercury-section-3"/);
  assert.match(funds, /data-testid="mercury-accept-3"/);
  assert.match(funds, /data-testid="mercury-dismiss-3"/);
  const room = render({ slug: 'data-room', part: { title: 'Add the last 12 statements to the data room', proposals: [{ id: 4, month: '2026-09', last_four: '4242' }] } });
  assert.match(room, /Add the last 12 statements to the data room/);
  assert.match(room, /Statement 2026-09 · account ending 4242/);
  assert.match(room, /seen by no investor until you open its access/);
  const credit = mercuryView('capital-relationships', { proposals: [{ id: 5, amount_cents: 5000000, counterparty: 'Harbour Angels LLC', posted_on: '2026-09-20', match: { prospect_id: 1, name: 'Harbour Angels' } }, { id: 6, amount_cents: 2500000, counterparty: null, posted_on: '2026-09-25', match: null }] });
  assert.deepEqual(credit.proposals.map((p) => p.action), ['Match to Harbour Angels', 'Add as a new investor, at Committed']);
  assert.match(credit.proposals[1].text, /a counterparty Mercury did not name/);
  assert.equal(isEmptyView(mercuryView('cap-table', { proposals: [] })), true);
  assert.match(render({ slug: 'cap-table', part: { state: 'unreadable', reason: 'What Mercury fed this module could not be read' } }), /Unreadable: What Mercury fed/);
});

test('the client calls the Worker\'s four Mercury routes', () => {
  // Mutations checked: a path renamed on either side.
  for (const [method, path] of [['post', '/mercury/sync'], ['post', '/mercury/proposals/:id/accept'], ['post', '/mercury/proposals/:id/dismiss'], ['delete', '/mercury/facts/:id']]) {
    assert.ok(WORKER.includes(`cycleRaise.${method}('${path}'`), path);
  }
  assert.match(WRITES, /\/cycles\/raise\/mercury\/sync\?/);
  assert.match(WRITES, /\/cycles\/raise\/mercury\/proposals\/\$\{seg\(id\)\}\/accept\?/);
  assert.match(WRITES, /\/cycles\/raise\/mercury\/proposals\/\$\{seg\(id\)\}\/dismiss\?/);
  assert.match(WRITES, /\/cycles\/raise\/mercury\/facts\/\$\{seg\(id\)\}\?.*method: 'DELETE'/);
});

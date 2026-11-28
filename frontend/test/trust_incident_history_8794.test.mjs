/**
 * D8794 (#8794) — the public Trust incident history, as the browser retest
 * measured it (documentation/architecture/decisions/D8794.md).
 *
 * The strip draws one fixed 3 px mark per day with a 2 px gap and never
 * shrinks them, so 90 days need 448 px whatever the card's width. At 390 and
 * 320 px the settled document grew to 483 px once the history arrived; it
 * fitted while loading. The containment is a layout decision that waits on
 * the canvas (`needs-design`). These checks pin what the canvas must keep
 * (the meaning of recorded and unrecorded days, the text summary that needs
 * neither colour nor a pointer) and the geometry that overflows today, so the
 * build to the canvas updates this file on purpose.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/trust_incident_history_8794.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { statusStrip } from '../src/pages/site/trustCenterModel.js';

const DAY = 86400000;
const START = Date.UTC(2026, 7, 30); // 90 days ending 2026-11-27
/** One monitored service's fictional history: `recorded` of the 90 days recorded, the rest before records began. */
function read(recorded, incidentEvery = 23) {
  const history = Array.from({ length: 90 }, (_, i) => ({
    day: new Date(START + i * DAY).toISOString().slice(0, 10),
    status: i < 90 - recorded ? 'not_recorded' : (i % incidentEvery === 0 ? 'degraded' : 'no_incident'),
  }));
  const since = history.find((d) => d.status !== 'not_recorded')?.day ?? null;
  return { status: 'ready', data: { services: [{ key: 'api', label: 'API', monitoring: 'monitored', records_since: since, history }] } };
}

test('loading and unreadable draw no marks, so the page width is the same as before history arrives', () => {
  assert.deepEqual(statusStrip({ status: 'loading', data: null }), { state: 'loading' });
  assert.deepEqual(statusStrip({ status: 'error', data: null }), { state: 'unreadable' });
});

test('partial history: 90 marks, the first 60 Not recorded, and a summary that says so in words', () => {
  const s = statusStrip(read(30));
  assert.equal(s.state, 'ready');
  assert.equal(s.cells.length, 90, 'an unrecorded day is still a mark: it is never dropped or drawn as a good day');
  assert.equal(s.cells.filter((c) => c.status === 'not_recorded').length, 60);
  assert.equal(s.line, 'Days with no incident reported: 29 of 30 days recorded');
  assert.equal(s.alt, 'Incident history: no incident reported on 29 of 30 days recorded; the 60 days before records began are not recorded.');
  assert.match(s.title, /^Status · records began on /);
});

test('complete history: 90 recorded marks and the same kind of summary', () => {
  const s = statusStrip(read(90));
  assert.equal(s.cells.length, 90);
  assert.equal(s.cells.some((c) => c.status === 'not_recorded'), false);
  assert.equal(s.alt, 'Incident history: no incident reported on 86 of 90 days recorded.');
  assert.equal(s.title, 'Status');
});

test('the strip today: fixed 3 px marks, 2 px gaps, no shrinking — 448 px for 90 days (the retest’s reading)', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/site/TrustCenter.jsx'), 'utf8');
  const strip = src.slice(src.indexOf('data-testid="trust-status-cells"') - 200, src.indexOf('data-testid="trust-status-count"'));
  assert.match(strip, /className="flex items-end gap-\[2px\]" role="img" aria-label=\{s\.alt\}/, 'the summary is the strip’s accessible name');
  assert.match(strip, /inline-block h-6 w-\[3px\] flex-none rounded-sm/, 'each mark is 3 px and never shrinks');
  const width = (days) => days * 3 + (days - 1) * 2;
  assert.equal(width(90), 448, 'what the retest measured as the strip’s scroll width at 390 and 320');
  // The card's content box at 390 px measured 320 px and at 320 px 250 px: both narrower than 448.
  for (const [viewport, content] of [[390, 320], [320, 250]]) assert.ok(width(90) > content, `${viewport} px`);
  // The text summary and legend are drawn as text, not only as colour.
  assert.match(src, /data-testid="trust-status-count">\{s\.line\}/);
  for (const word of ['No incident reported', 'Incident reported', 'Outage reported']) assert.ok(src.includes(`'${word}'`), word);
  assert.match(src, /<Link to="\/status" className=\{LINK\}>Status page ›<\/Link>/);
});

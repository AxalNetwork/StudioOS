/**
 * D361 — the 83(b) filing record, and Section83bPage retired into the Lab page.
 *
 * WHAT THIS PINS.
 *   - Every date the page sends is one the founder typed. "Mark as filed" used
 *     to send `new Date().toISOString()` as the mailing date — the moment of
 *     the click, recorded as the postmark of an IRS filing.
 *   - The page's filing methods are exactly the Worker's (read from its source,
 *     so a method added on one side and not the other fails here).
 *   - The canvas features with no store say so: operator assist, reminders.
 *   - Section83bPage is gone, the Legal Engine card embeds the Lab page, the
 *     hub no longer claims "Not set up" for stores it never reads, and
 *     /incorporate/83b lands every viewer somewhere they can open.
 *
 * WHY SOURCE TEXT. The page loads in a `useEffect`, which
 * `renderToStaticMarkup` never runs (frontend/test/README.md). The pure
 * exports (FILING_METHODS, isoDay) are imported and run for real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/SpinoutLab83bPage.jsx');
const ENGINE = read('frontend/src/pages/LegalEnginePage.jsx');
const APP = read('frontend/src/App.jsx');
const SERVICE = read('cloudflare-worker/src/services/section83b.ts');

/** Source with comments removed, so a guard cannot be satisfied by prose. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

test('no 83(b) write sends the clock as a date', () => {
  const c = code(PAGE);
  // Every legal83bUpdate call, with the object it sends.
  const calls = c.match(/legal83bUpdate\([^;]*?\)/g) || [];
  assert.ok(calls.length >= 2, 'expected the record save and the delivery confirmation');
  for (const call of calls) {
    assert.doesNotMatch(call, /new Date\(/, `a write sends the clock: ${call}`);
    assert.doesNotMatch(call, /mailed_at/, 'the page sends mailed_on, a date the founder typed');
  }
  const save = between(c, 'const saveRecord = async () => {', 'const confirmDelivery');
  assert.match(save, /mailed_on: record\.mailed_on/);
  assert.doesNotMatch(save, /new Date\(/);
  // The form opens with no date unless one is already on record.
  const open = between(c, 'const openRecord = (kind) => {', 'const recordReady');
  assert.match(open, /mailed_on: tracker\?\.mailed_at \? String\(tracker\.mailed_at\)\.slice\(0, 10\) : ''/);
  assert.match(open, /: \{ kind, date: '' \}/);
  assert.doesNotMatch(open, /new Date\(/);
});

test('saving needs a typed date and a chosen method — no defaults', async () => {
  const ready = between(code(PAGE), 'const recordReady = ', ';\n');
  assert.match(ready, /isoDay\(record\.mailed_on\) && FILING_METHODS\.some\(\(m\) => m\.k === record\.filing_method\)/);
  assert.match(ready, /isoDay\(record\.date\)/);
  assert.match(PAGE, /disabled=\{busy \|\| !recordReady\} data-testid="button-save-record"/);
  const { isoDay } = await import('../src/pages/SpinoutLab83bPage.jsx');
  assert.equal(isoDay(''), false);
  assert.equal(isoDay(undefined), false);
  assert.equal(isoDay('2026-06-04'), true);
  assert.equal(isoDay('06/04/2026'), false);
});

test("the page's filing methods are exactly the Worker's", async () => {
  const { FILING_METHODS } = await import('../src/pages/SpinoutLab83bPage.jsx');
  const worker = /export const FILING_METHODS = \[([^\]]*)\] as const/.exec(SERVICE);
  assert.ok(worker, 'the Worker declares FILING_METHODS');
  const workerKeys = [...worker[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(FILING_METHODS.map((m) => m.k).sort(), workerKeys);
});

test('delivery confirmation is offered only once a mailing date is on record', () => {
  assert.match(PAGE, /\{tracker\.mailed_at && String\(tracker\.status\) !== 'confirmed' && \(\n\s*<button\n\s*type="button" onClick=\{confirmDelivery\}/);
});

test('operator assist and reminders render Not recorded with their reasons', () => {
  const card = between(PAGE, 'data-testid="card-83b-unrecorded"', '{trackers.length > 1');
  assert.match(card, /Operator assist<\/span>\s*<Unrecorded reason="[^"]+"/);
  assert.match(card, /Deadline reminders<\/span>\s*<Unrecorded reason="[^"]+"/);
});

test('Section83bPage is retired into the Lab page on the Legal Engine card', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/pages/Section83bPage.jsx')), false, 'the old component is deleted, not orphaned');
  assert.match(ENGINE, /import SpinoutLab83bPage from '\.\/SpinoutLab83bPage';/);
  assert.doesNotMatch(code(ENGINE), /Section83bPage/);
  const equity = between(ENGINE, "id: 'equity'", '},');
  assert.match(equity, /requiredTier: 'studio'/, 'the Studio gate on the card is unchanged');
  assert.match(equity, /Component: SpinoutLab83bPage/);
  // Embedded, the Lab header is left out (the card has its own).
  assert.match(PAGE, /\{!embedded && \(\n\s*<LabPageHeader/);
});

test('the Legal Engine no longer claims "Not set up" for stores it never reads', () => {
  const c = code(ENGINE);
  assert.doesNotMatch(c, /Not set up/);
  assert.doesNotMatch(c, /state="not_set_up"/);
  assert.match(c, /<Unrecorded reason="[^"]+"/);
});

test('/incorporate/83b lands each viewer on a route they can open', () => {
  const line = APP.split('\n').find((l) => l.includes('path="/incorporate/83b"'));
  assert.ok(line, 'the old route is kept as a redirect, never a 404');
  assert.match(line, /<Navigate to=\{user\?\.spinout_lab_active === 1 \|\| user\?\.role === 'admin' \? '\/spinout-lab\/83b' : '\/raise\/legal-engine\/equity'\} replace \/>/);
});

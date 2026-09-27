/**
 * D363 — the revenue ledger on the Revenue page.
 *
 * The page-side rules (lib/revenueLedger.js) run for real: integer-cent sums,
 * the canvas's five filters, CSV parsing and column mapping, and the verified
 * share that stays null — never 0% — while no entry could be Stripe-verified.
 * The component (components/spinout/RevenueLedger.jsx) loads in a useEffect,
 * so its render paths are pinned as source text, bounded to their blocks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEDGER_FILTERS, fmtLedgerCents, summarizeLedger, parseCsv, guessMapping,
  mapImportRows, normalizeCsvDate,
} from '../src/lib/revenueLedger.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LEDGER = read('frontend/src/components/spinout/RevenueLedger.jsx');
const PAGE = read('frontend/src/pages/SpinoutLabRevenuePage.jsx');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

const E = (o) => ({ customer: 'Acme', amount_cents: 1000, revenue_type: 'recurring', verification: 'manual', source: 'manual', proof_document_id: null, ...o });

test('sums stay in integer cents, split by type and by evidence', () => {
  const s = summarizeLedger([
    E({ amount_cents: 49000 }),
    E({ customer: 'acme ', amount_cents: 150050, revenue_type: 'pilot', verification: 'supported', proof_document_id: 5 }),
    E({ customer: 'Cedar', amount_cents: 30000, revenue_type: 'one_time' }),
    E({ amount_cents: 12.5 }), // not an integer: not a figure, not summed
  ]);
  assert.equal(s.totalCents, 229050);
  assert.equal(s.count, 3);
  assert.equal(s.customers, 2, 'names are compared trimmed and case-folded');
  assert.deepEqual(s.byVerification, { verified: 0, supported: 150050, manual: 79000 });
  assert.equal(s.byType.pilot, 150050);
  assert.equal(s.proofBacked, 1);
  assert.equal(fmtLedgerCents(150050), '$1,500.50');
  assert.equal(fmtLedgerCents(49000), '$490');
  assert.equal(fmtLedgerCents(null), null);
});

test('verified share is null until an entry could be verified — never 0%', () => {
  assert.equal(summarizeLedger([E({}), E({ verification: 'supported', proof_document_id: 1 })]).verifiedShare, null);
  assert.equal(summarizeLedger([]).verifiedShare, null);
  const withStripe = summarizeLedger([E({ amount_cents: 3000, source: 'stripe', verification: 'verified' }), E({ amount_cents: 1000 })]);
  assert.equal(withStripe.verifiedShare, 0.75);
  // The page renders the null as Not recorded with its reason.
  const kpi = between(LEDGER, "k: 'verified'", '},');
  assert.match(kpi, /value: summary\.verifiedShare === null \? 'unrecorded'/);
  assert.match(LEDGER, /kpi\.value === 'unrecorded'\s*\?\s*<Unrecorded reason="Verified means synced from a Stripe charge[^"]*"/);
});

test('the five filters are the canvas\'s, and investor view hides only unevidenced rows', () => {
  assert.deepEqual(LEDGER_FILTERS.map((f) => f.label), ['All', 'Recurring', 'Pilots & deposits', 'Verified', 'Unverified']);
  const rows = [E({ revenue_type: 'deposit' }), E({ revenue_type: 'pilot', verification: 'supported' }), E({})];
  const pick = (k) => rows.filter(LEDGER_FILTERS.find((f) => f.k === k).test).length;
  assert.equal(pick('pilot'), 2);
  assert.equal(pick('unverified'), 2);
  assert.equal(pick('verified'), 0);
  const shown = between(LEDGER, 'const shown = useMemo(', '}, [entries, filter, investorView]);');
  assert.match(shown, /\.filter\(\(e\) => !investorView \|\| e\.verification !== 'manual'\)/);
});

test('CSV: quoted cells, mapping guesses, US dates, and amounts passed on as text', () => {
  const rows = parseCsv('Customer,Amount,Date,Type\r\n"Cedar, & Co.","1,200.50",7/18/2026,Pilot\n"Quote ""Inc""",300,2026-06-01,\n\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['Cedar, & Co.', '1,200.50', '7/18/2026', 'Pilot']);
  assert.equal(rows[2][0], 'Quote "Inc"');
  const mapping = guessMapping(rows[0]);
  assert.deepEqual(mapping, { customer: 0, amount: 1, received_on: 2, revenue_type: 3 });
  const out = mapImportRows(rows.slice(1), mapping, 'one_time');
  assert.deepEqual(out[0], { customer: 'Cedar, & Co.', amount: '1,200.50', received_on: '2026-07-18', revenue_type: 'Pilot' });
  assert.equal(typeof out[0].amount, 'string', 'the Worker parses the amount exactly; the page never floats it');
  assert.equal(normalizeCsvDate('18/07/2026'), '18/07/2026', 'a day-first date is not guessed');
  const noType = mapImportRows(rows.slice(1), { ...mapping, revenue_type: null }, 'deposit');
  assert.equal(noType[1].revenue_type, 'deposit');
});

test('a failed ledger read is Unreadable, never "No revenue entries"', () => {
  const body = between(LEDGER, "{read.status === 'loading' ? (", 'data-testid="ledger-empty"');
  assert.match(body, /\) : read\.status === 'failed' \? \(\n\s*<div className="py-4" data-testid="ledger-unreadable">\n\s*<Unreadable/);
  const load = between(LEDGER, 'const load = useCallback(async () => {', '}, [project.id]);');
  assert.match(load, /setRead\(\{ status: 'failed', entries: \[\] \}\)/);
  // KPIs built from a failed read are not "$0".
  assert.match(LEDGER, /value: read\.status === 'failed' \? null : fmtLedgerCents\(summary\.totalCents\)/);
});

test('manual entry sends integer cents, a typed date and a chosen type — no defaults', async () => {
  const { typedAmountToCents } = await import('../src/components/spinout/RevenueLedger.jsx');
  assert.equal(typedAmountToCents('1,200.50'), 120050);
  assert.equal(typedAmountToCents('12.345'), null);
  assert.equal(typedAmountToCents('0'), null);
  assert.match(LEDGER, /const EMPTY_FORM = \{ customer: '', amount: '', received_on: '', revenue_type: '', proof_document_id: '' \};/);
  const save = between(code(LEDGER), 'const saveManual = async () => {', 'const onFile');
  assert.match(save, /amount_cents: formCents,/);
  assert.doesNotMatch(save, /verification|source:/, 'verification is the Worker\'s to set');
  assert.doesNotMatch(code(LEDGER), /\|\| 0\b|\?\? 0\b/);
});

test('the Revenue page mounts the ledger and no longer calls it unbuilt', () => {
  assert.match(PAGE, /<RevenueLedger project=\{project\} canEdit=\{canEdit\} \/>/);
  assert.doesNotMatch(PAGE, /intentionally NOT reproduced/);
  assert.match(LEDGER, /data-testid="ledger-mode-note">\s*The design's Week 3 \/ Week 4 mode tabs are not built/, 'an unbuilt drawn control is named on screen');
});

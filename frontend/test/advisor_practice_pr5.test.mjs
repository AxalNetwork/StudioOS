/**
 * Practice · Earnings — canvas **D4**, `/practice/earnings`, tagged LEDGER.
 * Since #4834 (D4834) the page is built to Practice v2 PX-07; the layout
 * checks below read that canvas, and the period and payout-day checks stand.
 *
 * D4 IS NOT IN THE PRACTICE CANVAS, and that is the first thing to know about
 * testing it. `Advisor Detail · Practice.dc.html` draws PR5 as a POINTER —
 * *"/practice/earnings · drawn in full as D4"* — and D4 itself lives in
 * `design/canvases/backlog/Detail Layer Canvas II.dc.html`. The backlog file
 * stays in `backlog/` by decision; reading it for intent is not promoting it,
 * which is why this file reads it and the zone registries' guards read exactly
 * one artboard out of it by route.
 *
 * WHAT THESE TESTS ARE FOR. The page performs no money arithmetic — gross, cut
 * and net arrive already reconciling from `services/advisorMoney.ts`, checked
 * exhaustively in `cloudflare-worker/test/advisor_money_model.test.ts`. What
 * lives here is the other half, and each piece of it fails silently:
 *
 *   * A PERIOD IS A CALENDAR LABEL AND ITS BOUNDS ARE INSTANTS. `2026-Q3` is a
 *     key and a chip; `from`/`until` are UTC, because that is what
 *     `created_at` is. Deriving bounds from a local midnight would file a
 *     1 July session in Sydney under Q2, and nothing would look wrong.
 *   * THE WINDOW IS HALF-OPEN. An inclusive `until` puts a session at midnight
 *     on 1 October in both Q3 and Q4, and two adjacent tables that cannot both
 *     be right is worse than one that is wrong.
 *   * `last_quarter` WRAPS INTO THE PREVIOUS YEAR. The off-by-one produces a
 *     table labelled Q0, in January, once a year.
 *   * A SHARE OF NOTHING IS NOT NOUGHT PER CENT — 0% reads as "well spread".
 *   * A SCHEDULED PAYOUT DAY IS NOT AN INSTANT. `new Date('2026-09-01')` is
 *     midnight UTC and shows "Aug 31" to every reader west of Greenwich.
 *   * A NOTE MAY HAVE STOPPED DESCRIBING THE TABLE, and "no stamped figures"
 *     is not "still current" (D56/D68).
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_practice_pr5.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

// The pure module, not the page: importing the page pulls React and a `.css`
// through its component tree, which the loader cannot resolve.
import {
  LEDGER_VIEWS, PAYOUT_STATE_LABEL, PAYOUT_TONE, cutNote, noteIsStale,
  payoutWhen, periodWindow, quarterKey, quarterOf, sharePct, viewLabels,
} from '../src/pages/advisor/practice/earningsLedger.js';
import { advisorRoutesSource } from './_advisorRoutesSource.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/advisor/practice/EarningsZone.jsx');
const P = codeOnly(PAGE);
// #4715: the advisor router is advisors.ts plus the route modules it mounts.
const WORKER = advisorRoutesSource();
const MONEY = read('cloudflare-worker/src/services/advisorMoney.ts');
const API = read('frontend/src/lib/api.js');
const D4 = read('design/canvases/backlog/Detail Layer Canvas II.dc.html');

// The D4 artboard, sliced so no assertion can be satisfied by a neighbour —
// this file also holds D5 (cohorts) and two partner artboards.
const ART = D4.slice(D4.indexOf('<!-- ══════════ D4'), D4.indexOf('<!-- ══════════ D5'));
// THE DATA BLOCK, NOT THE MARKUP. D4's markup only loops — `{{ s.label }}`,
// `{{ p.gate }}` — and every string this file checks lives in the canvas's own
// data block far below it. The first draft sliced to `d4Narrative` and got an
// EMPTY range, because the binding `{{ d4Narrative }}` appears in the markup
// thousands of characters BEFORE the block it names. `d4Narrative:` with its
// colon is the declaration.
const DATA_AT = D4.indexOf('// ══ D4 · earnings ══');
const DATA = D4.slice(DATA_AT, D4.indexOf('d4Narrative:', DATA_AT));

// ── The window ─────────────────────────────────────────────────────────────

test('a quarter is read from the reader’s own calendar, not from UTC', () => {
  // A reader in Sydney on 1 July means Q3 even while UTC still says 30 June,
  // so the MONTH is local. Checked at all twelve so an off-by-one in the
  // divide-by-three cannot hide in the month nobody tries.
  for (let m = 0; m < 12; m += 1) {
    const d = new Date(2026, m, 15, 12, 0, 0);
    assert.equal(quarterOf(d), Math.floor(m / 3) + 1, `month ${m}`);
  }
  assert.equal(quarterKey(2026, 3), '2026-Q3');
});

test('the window’s bounds are UTC instants and its key is a calendar label', () => {
  const w = periodWindow('this_quarter', new Date(2026, 7, 15, 12, 0, 0));  // 15 Aug 2026
  assert.equal(w.key, '2026-Q3');
  assert.equal(w.label, 'Q3 2026');
  // EXACT UTC MIDNIGHTS, not a local one formatted. A local Date(2026, 6, 1)
  // is 1 July at the reader's offset, which is 30 June in UTC east of
  // Greenwich — so the ledger's `created_at >= ?` would miss a whole day.
  assert.equal(w.from, '2026-07-01T00:00:00.000Z');
  assert.equal(w.until, '2026-10-01T00:00:00.000Z');
});

test('the window is half-open, so two adjacent quarters cannot both claim a row', () => {
  const q3 = periodWindow('this_quarter', new Date(2026, 7, 15));
  const q4 = periodWindow('this_quarter', new Date(2026, 10, 15));
  assert.equal(q3.until, q4.from, 'one quarter ends exactly where the next begins');
  assert.equal(q4.key, '2026-Q4');
});

test('last quarter wraps into the previous year rather than producing a Q0', () => {
  // THE ONE THAT FAILS ONCE A YEAR, in January, and produces a table headed
  // "Q0 2026" over the wrong three months.
  const jan = periodWindow('last_quarter', new Date(2026, 0, 15));
  assert.equal(jan.key, '2025-Q4');
  assert.equal(jan.label, 'Q4 2025');
  assert.equal(jan.from, '2025-10-01T00:00:00.000Z');
  assert.equal(jan.until, '2026-01-01T00:00:00.000Z');
  // And the ordinary case, so the wrap is not applied everywhere.
  assert.equal(periodWindow('last_quarter', new Date(2026, 7, 15)).key, '2026-Q2');
});

test('year to date is the calendar year and all time has no bounds at all', () => {
  const ytd = periodWindow('ytd', new Date(2026, 7, 15));
  assert.equal(ytd.key, '2026');
  assert.equal(ytd.from, '2026-01-01T00:00:00.000Z');
  assert.equal(ytd.until, '2027-01-01T00:00:00.000Z');

  const all = periodWindow('all', new Date(2026, 7, 15));
  assert.equal(all.key, 'all');
  // NO BOUNDS, not a very old `from`. An absent bound is "every row"; a date
  // far enough back to look like one is a guess that eventually stops being
  // true.
  assert.equal(all.from, null);
  assert.equal(all.until, null);
});

test('the window is built in UTC and the quarter is chosen locally — structurally', () => {
  // EVERY BEHAVIOURAL ASSERTION ABOVE PASSES A WRONG IMPLEMENTATION, because
  // CI runs in UTC and there `new Date(y, m, 1)` and `Date.UTC(y, m, 1)` are
  // the same instant. Two mutations proved it: swapping `Date.UTC` for a local
  // constructor, and `getMonth` for `getUTCMonth`, both left this file green.
  //
  // So the two halves are pinned structurally, which is the only way to state
  // them where the test host cannot tell them apart. `payoutWhen` carries the
  // same kind of assertion for the same reason.
  const src = codeOnly(read('frontend/src/pages/advisor/practice/earningsLedger.js'));

  const win = src.slice(src.indexOf('export function periodWindow'));
  const winBody = win.slice(0, win.indexOf('\n}'));
  assert.match(winBody, /Date\.UTC\(/,
    'the bounds are compared against a UTC `created_at` and must be built in UTC');
  assert.equal(/new Date\(\s*\w+\s*,\s*\w/.test(winBody), false,
    'a local Date constructor here shifts the quarter boundary by the reader’s offset');

  const q = src.slice(src.indexOf('export function quarterOf'));
  const qBody = q.slice(0, q.indexOf('\n}'));
  assert.match(qBody, /getMonth\(\)/,
    'a reader in Sydney on 1 July means Q3 even while UTC still says 30 June');
  assert.equal(/getUTC/.test(qBody), false, 'the quarter is the reader’s, not Greenwich’s');
});

test('an unknown view falls back to this quarter rather than to nothing', () => {
  const w = periodWindow('banana', new Date(2026, 7, 15));
  assert.equal(w.key, '2026-Q3');
});

test('the four view labels are derived, never written down', () => {
  const labels = viewLabels(new Date(2026, 7, 15));
  assert.deepEqual(labels.map((l) => l.key), LEDGER_VIEWS);
  assert.deepEqual(labels.map((l) => l.label), ['Q3 2026', 'Q2 2026', 'Year to date', 'All time']);
  // AND THEY MOVE. A hard-coded pair passes the assertion above for ever and
  // is wrong from January; this is what proves they are computed.
  const later = viewLabels(new Date(2027, 1, 15));
  assert.deepEqual(later.map((l) => l.label), ['Q1 2027', 'Q4 2026', 'Year to date', 'All time']);
});

// ── The table's own derivations ────────────────────────────────────────────

test('a share of nothing is null, never nought per cent', () => {
  assert.equal(sharePct(5_000, 20_000), 25);
  assert.equal(sharePct(0, 20_000), 0, 'a real zero share of a real total IS zero');
  // 0% reads as "well spread", which is the opposite of what no revenue means.
  assert.equal(sharePct(5_000, 0), null);
  assert.equal(sharePct(5_000, null), null);
  assert.equal(sharePct(null, 20_000), null);
});

test('the cut note always states the per-line rule and claims nothing else unearned', () => {
  const always = /charged per line, not netted at the bottom/;

  const bare = cutNote({ cutLabel: null, concentration: null, equityClients: 0 });
  assert.match(bare, always);
  // NOT SAID over an empty window: a concentration over nothing is not a
  // fact, and "someone is missing from this table" is a claim about the
  // reader's own book.
  assert.equal(/% of gross/.test(bare), false);
  assert.equal(/equity/.test(bare), false);

  const full = cutNote({
    cutLabel: '$2,767.50',
    concentration: { client_name: 'Meridian Labs', pct: 41 },
    equityClients: 2,
  });
  assert.match(full, always);
  assert.match(full, /\$2,767\.50 in this window/);
  assert.match(full, /Meridian Labs is 41% of gross/);
  assert.match(full, /2 engagements are paid in equity/);
  // Singular, because "1 engagements are" is the tell that a count was
  // pluralised by accident.
  assert.match(
    cutNote({ cutLabel: null, concentration: null, equityClients: 1 }),
    /1 engagement is paid in equity/,
  );
  // A concentration with no percentage is not half-stated.
  assert.equal(
    /% of gross/.test(cutNote({ cutLabel: null, concentration: { client_name: 'X', pct: null }, equityClients: 0 })),
    false,
  );
});

test('a payout day and a payout instant are formatted by different rules', () => {
  // `scheduled_for` is a BANKING DAY. Rendered from its own parts, because
  // `new Date('2026-09-01')` is midnight UTC and shows "Aug 31" to every
  // reader west of Greenwich.
  const sched = payoutWhen({ scheduled_for: '2026-09-01', paid_at: null });
  assert.deepEqual(sched, { text: 'Sep 1', kind: 'scheduled' });
  // Stable wherever the reader is, which a Date-based version is not.
  assert.equal(payoutWhen({ scheduled_for: '2026-01-01' }).text, 'Jan 1');
  assert.equal(payoutWhen({ scheduled_for: '2026-12-31' }).text, 'Dec 31');

  // `paid_at` IS an instant: the moment it settled is the reader's own.
  const paid = payoutWhen({ scheduled_for: null, paid_at: '2026-08-22T12:00:00.000Z' });
  assert.equal(paid.kind, 'paid');
  assert.ok(paid.text, 'a real instant still formats');

  // A row with both is PAID — the settlement outranks the plan for it.
  assert.equal(payoutWhen({ scheduled_for: '2026-09-01', paid_at: '2026-08-22T12:00:00.000Z' }).kind, 'paid');
  // And a row with neither says so rather than inventing a date.
  assert.deepEqual(payoutWhen({}), { text: null, kind: 'none' });
  assert.deepEqual(payoutWhen(null), { text: null, kind: 'none' });
  assert.deepEqual(payoutWhen({ scheduled_for: 'not a day' }), { text: null, kind: 'none' });

  // THE STRUCTURAL HALF, because every assertion above also passes a
  // Date-based implementation in UTC — which is where CI runs. Sliced to the
  // function's own body: `paid_at` legitimately constructs a Date.
  const src = codeOnly(read('frontend/src/pages/advisor/practice/earningsLedger.js'));
  const fn = src.slice(src.indexOf('export function payoutWhen'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  const dayHalf = body.slice(body.indexOf('row?.scheduled_for'));
  assert.equal(/new Date|Date\.parse/.test(dayHalf), false,
    'the scheduled DAY must not be parsed as an instant');
});

test('every payout state has a label and a tone, and scheduled is not confident', () => {
  const m242 = read('cloudflare-worker/sql/migrations/242_advisor_quarter_notes.sql');
  void m242;
  const m241 = read('cloudflare-worker/sql/migrations/241_advisor_money_model.sql');
  const check = m241.match(/CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)/g)
    .find((c) => c.includes("'scheduled'"));
  const states = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(states, ['scheduled', 'paid', 'failed', 'reversed']);
  for (const s of states) {
    assert.ok(PAYOUT_STATE_LABEL[s], `no label for payout state '${s}'`);
    assert.ok(PAYOUT_TONE[s], `no tone for payout state '${s}'`);
  }
  // `scheduled` IS FUTURE TENSE. A confident colour on it would assert money
  // had moved, which is the one thing this page must not do while nothing
  // settles.
  assert.equal(PAYOUT_TONE.scheduled, 'neutral');
  assert.equal(PAYOUT_TONE.paid, 'ok');
});

test('a note with no stamped figures is not reported as current', () => {
  const totals = { gross_cents: 100, cut_cents: 15, net_cents: 85 };
  assert.equal(noteIsStale({ figures: totals }, totals), false);
  assert.equal(noteIsStale({ figures: { ...totals, gross_cents: 200 } }, totals), true);
  // NULL, NOT FALSE. Absent evidence is not evidence, so the page renders
  // nothing rather than a reassurance it cannot support (D56/D68).
  assert.equal(noteIsStale({ figures: null }, totals), null);
  assert.equal(noteIsStale({}, totals), null);
  assert.equal(noteIsStale(null, totals), null);
  assert.equal(noteIsStale({ figures: totals }, null), null);
  assert.equal(noteIsStale({ figures: { gross_cents: 100 } }, totals), null,
    'a partial stamp cannot be compared and is not "current"');
});

// ── The page against the artboard ──────────────────────────────────────────

// #4834 (D4834): Practice v2 (PX-07) replaced D4's tiles, by-client table,
// payout cards and AI band. The page is checked against the v2 builder now;
// the window, payout-day and stale-note checks above are unchanged.
const V2 = read('design/incoming/Practice v2 Page.dc.html');
const PX07 = V2.slice(V2.indexOf('/* ---------- PX07 earnings ---------- */'), V2.indexOf('/* ---------- PX08 states ---------- */'));
const LEDGER_MODULE = read('frontend/src/pages/advisor/practice/earningsLedger.js');

test('the cards are Practice v2’s, in its order, and none is called received', () => {
  const drawn = [...PX07.matchAll(/\[\['Recorded billed'[\s\S]*?\]\]\.map/g)][0]?.[0] || '';
  const labels = [...drawn.matchAll(/\['([^']+)', '\$/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Recorded billed', 'Recorded collected', 'Outstanding', 'Platform fees', 'Paid out']);
  const order = labels.map((l) => LEDGER_MODULE.indexOf(`label: '${l}'`));
  assert.ok(order.every((i) => i > 0), 'every canvas card has a label in earningsCards');
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'in the canvas’s order');
  assert.doesNotMatch(P, /You received|You receive\b/);
  assert.doesNotMatch(codeOnly(LEDGER_MODULE).slice(LEDGER_MODULE.indexOf('#4834 (D4834) — Practice v2 Earnings')), /label: '[^']*[Rr]eceiv/);
});

test('the ledger columns are the canvas’s, named as the issue names them', () => {
  const head = PX07.slice(PX07.indexOf('<thead>'), PX07.indexOf('</thead>'));
  const canvas = [...head.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(canvas, ['Client', 'Session / engagement', 'Price', 'Billing', 'Collected', 'Rate', 'Fee', 'Net']);
  const page = [...P.slice(P.indexOf('const COLUMNS = ['), P.indexOf('];', P.indexOf('const COLUMNS = ['))).matchAll(/\['\w+', '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(page, ['Client', 'Session / engagement', 'Price', 'Billing state', 'Recorded collected', 'Platform rate', 'Platform fee', 'Net', 'Date']);
  assert.match(PX07, /rates are fixed when a record is priced/);
  assert.match(P, /rates are fixed when a record is priced/);
});

test('the note and the three payout parts the canvas separates are all present', () => {
  assert.match(PX07, /<h2>Note for November 2026<\/h2>/);
  assert.match(P, /`Note for \$\{window_\.label\}`/);
  for (const part of ['Payout setup', 'Payout history']) {
    assert.ok(PX07.includes(part), `the canvas no longer draws ${part}`);
    assert.ok(P.includes(`>${part}</h4>`), `the page is missing ${part}`);
  }
  // The recorded balance is its own part, and nothing records one.
  assert.ok(P.includes('>Recorded balance</h4>'));
  assert.match(P, /Axal holds no balance on your behalf/);
});

test('the page holds all three payout gate sentences, the Worker’s own', () => {
  // D4 drew all three; Practice v2 draws the reader's own (#4834). The page
  // keeps the three sentences so whichever state the Worker answers is said
  // in the artboard's words.
  for (const gate of [
    'Paid sessions bookable and chargeable.',
    'Bookable, held uncharged until verification clears.',
    'Paid slots hidden from your profile. Free intro calls still bookable.',
  ]) {
    assert.ok(DATA.includes(gate), `the canvas no longer draws "${gate}"`);
    assert.ok(P.includes(gate), `the page is missing "${gate}"`);
  }
  // AND THE WORKER HOLDS THE SAME THREE, so the two halves cannot describe
  // one state differently.
  const gates = MONEY.slice(MONEY.indexOf('export const PAYOUT_GATE'));
  for (const s of ['verified', 'pending', 'blocked']) {
    assert.ok(gates.slice(0, gates.indexOf('};')).includes(`${s}:`), `no gate for '${s}'`);
  }
});

test('the AI band quotes a MEASURED cost, never a modelled one', () => {
  // D16. The rail says it in its own words — "Measured, never modelled …
  // absent until they have run it once, because a number nobody measured is
  // worth less than saying so" — and D4 draws a cost chip that would be very
  // easy to fill with an estimate.
  assert.match(P, /No runs of this yet, so there is no average to quote/);
  assert.match(P, /your average over/);
  // Nothing multiplies a token count into a price on this page.
  assert.equal(/tokens?\s*\*|\* *0\.\d+ *\/ *1_?000/.test(P), false);
});

test('the two ops are handlers and the 1099 export carries its own disclaimer', () => {
  assert.match(ART, /Export CSV/);
  assert.match(ART, /Download 1099 summary/);
  const ACTIONS = read('frontend/src/workspaces/advisorZoneActions.js');
  const entry = ACTIONS.slice(ACTIONS.indexOf("'practice/earnings': ["));
  const block = entry.slice(0, entry.indexOf('],'));
  assert.match(block, /label: 'Export CSV', kind: 'handler'/);
  assert.match(block, /label: 'Download 1099 summary', kind: 'handler'/);
  assert.equal(block.includes('unbuilt'), false);

  // THE DISCLAIMER TRAVELS WITH THE FILE. The worker puts it in the payload
  // so a number exported without it cannot be taken for a tax document, and
  // the page writes it into the CSV rather than showing it once on screen.
  assert.match(P, /\['Note', `"\$\{String\(s\.document\?\.note/);
  assert.match(P, /\['Basis',/);
  assert.match(WORKER, /not an IRS Form 1099/);
});

test('BOTH CSVs export an absent figure as an empty cell, never as zero', () => {
  // A spreadsheet is where a zero becomes permanent: it outlives the page that
  // explained it. `cents()` answers '' for null for exactly that reason.
  //
  // BOTH, and the plural is the point: this page writes two CSVs — the ledger
  // and the tax summary — and each defines its own `cents`. `assert.match`
  // finds the first, so a mutation that coerced the SECOND one's null to zero
  // left this green. Counted rather than matched.
  const defs = [...P.matchAll(/const cents = \(v\) => [^;]+;/g)].map((m) => m[0]);
  assert.equal(defs.length, 2, `expected two CSV cent formatters, found ${defs.length}`);
  for (const d of defs) {
    assert.match(d, /v == null \? ''/, `a CSV formatter coerces an absent figure: ${d}`);
    assert.equal(/\|\| *0|\?\? *0/.test(d), false, `a CSV formatter defaults to zero: ${d}`);
  }
  assert.match(P, /'Unpriced sessions'/);
});

test('the page reads the ledger and never computes money itself', () => {
  for (const m of ['getMyAdvisorLedger', 'getMyAdvisorPayoutAccount', 'listMyAdvisorPayouts',
    'getMyAdvisorTaxSummary', 'getMyAdvisorPeriodNote', 'saveMyAdvisorPeriodNote',
    'deleteMyAdvisorPeriodNote']) {
    assert.ok(API.includes(m), `api.js is missing ${m}`);
    assert.ok(P.includes(m), `the page never calls ${m}`);
  }
  // NO CENT ARITHMETIC IN THE COMPONENT. The one division it does is bps→%,
  // which is a display conversion (1500 bps IS 15%, exactly); a cut computed
  // here would be a rounding choice nobody can audit.
  assert.equal(/gross_cents\s*[-*]\s*/.test(P), false, 'the page derives a cent figure');
  assert.equal(/cut_cents\s*=\s*/.test(P), false);
  assert.match(P, /Number\(bps\) \/ 100/);
});

test('nothing on this page claims a client was charged', () => {
  // BANNING THE WORD IS THE WRONG GUARD, and the first draft of this test
  // proved it by failing on the page's own honest sentence: "nothing has been
  // charged under it" contains "has been charged". A page that may not say
  // the word cannot say the true thing either, so what is banned is the
  // AFFIRMATIVE — an occurrence with no negation in front of it.
  //
  // Asserted on `codeOnly`, because the docblock says the words in the course
  // of explaining the rule — the self-matching trap.
  const NEGATED = /(nothing|not |never|no payment|cannot|could not)[^.]{0,60}$/i;
  for (const m of P.matchAll(/\b(?:was|were|has been|have been) (?:charged|paid out|settled)\b/gi)) {
    const before = P.slice(Math.max(0, m.index - 70), m.index);
    assert.ok(NEGATED.test(before),
      `an unnegated "${m[0]}" — no surface may state a charge the platform cannot make: `
      + `…${P.slice(Math.max(0, m.index - 70), m.index + 40).replace(/\s+/g, ' ')}…`);
  }
  // And the positive: the page renders the claim from `settlement` rather
  // than from a sentence written once.
  assert.match(P, /L\.settlement === 'none'/);
  assert.match(P, /nothing has been charged under it/);
  // The mirror, so the ban cannot be satisfied by removing the subject: the
  // page must still be able to say what happens when settlement is ON.
  assert.match(P, /Payments are running in/);
});

test('the absences this page must state are stated', () => {
  // Every one of these is a place a plausible number would fit (D56/D68).
  assert.match(P, /<Unrecorded \/>/);                    // an absent price, fee or net
  assert.match(P, /unpriced_sessions/);                  // in the total
  assert.match(P, /Not collected/);                      // billed is not collected
  assert.match(P, /priced before rates were stamped/);   // a line with no rate of its own
  assert.match(P, /No margin here, only revenue/);       // the stated limit
  assert.match(P, /a rate that could not be read/);      // an absent take rate
  // And no `?? 0` over a money field, which is how an absence becomes a
  // figure without anyone deciding to.
  assert.equal(/(gross|cut|net|retainer|amount)_cents\s*(\?\?|\|\|)\s*0(?![\d.])/.test(P), false);
});

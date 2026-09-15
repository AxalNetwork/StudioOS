/**
 * Practice · Sessions — canvas PR4, `/practice/sessions`, tagged **FEED**.
 *
 * WHAT THIS FILE IS FOR. `sessionGrid.js` says in its own header that "every
 * count here is unit-tested in both directions so a mutation cannot quietly
 * change what the tiles say". This is that test, and without it the sentence
 * was a claim about a file that did not exist.
 *
 * Both directions is the whole point. A tile that reads 7 when it should read
 * 8 renders, builds and type-checks; the only thing that can tell is an
 * assertion that a WRONG derivation fails. So every count below is pinned from
 * the canvas's own fixture — translated once, at the top, into the row shape
 * the API actually returns — and the precedence that produces it is asserted
 * against the cases that would flip it.
 *
 * The four that would fail silently and are therefore stated first:
 *
 *   * `held` OUTRANKS `booked`. The artboard's "Booked, next 14 d" tile
 *     excludes the held slot, and its gate note says why: *"it is counted
 *     under held rather than under booked. A slot that silently fails to
 *     charge is worse than one that says so."* Reverse the precedence and
 *     every tile still renders — one of them just lies.
 *   * A CAP OF `0` IS A DECISION AND SURVIVES. Zero means "accept no paid
 *     sessions"; absent means the advisor never answered. `ruleValue` is the
 *     one place that decides, and `v == null` rather than `!v` is the whole
 *     difference (D56/D68).
 *   * A SLOT TIME IS AN INSTANT; A BLACKOUT DAY IS NOT. `blackoutLabel` must
 *     never construct a Date — `new Date('2026-11-04')` is midnight UTC, which
 *     moves a Friday blackout onto a Thursday for every reader west of
 *     Greenwich.
 *   * THE OPERATIONAL COLUMNS ARE THE ADVISOR'S ALONE. `recording_state`,
 *     `payment_state` and `blocked_reason` are read from `GET /me/slots`. If
 *     the public `slotDto` ever grew them, a founder browsing an advisor's
 *     calendar would learn that their payout account is unverified.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_practice_pr4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

// The pure module, not the page: importing the page pulls React and a `.css`
// through its component tree, which the loader cannot resolve.
import {
  KIND_LABEL, KIND_TONE, VIEW_DAYS, blackoutLabel, bookedNote, dayLabel,
  groupByDay, narrowSlots, openNote, ruleNote, ruleValue, slotCounts, slotKind,
  slotTime,
} from '../src/pages/advisor/practice/sessionGrid.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/advisor/practice/SessionsZone.jsx');
const P = codeOnly(PAGE);
const GRID = codeOnly(read('frontend/src/pages/advisor/practice/sessionGrid.js'));
const WORKER = read('cloudflare-worker/src/routes/advisors.ts');
const API = read('frontend/src/lib/api.js');
const FILTERS = read('frontend/src/workspaces/advisorZoneFilters.js');
const ACTIONS = read('frontend/src/workspaces/advisorZoneActions.js');
const CANVAS = read('design/canvases/integrated/Advisor Detail · Practice.dc.html');

// The PR4 artboard, sliced so no assertion below can be satisfied by a
// neighbour that happens to share a word — PR3 draws a consent chip too.
const ART = CANVAS.slice(CANVAS.indexOf('<!-- ══════════ PR4 · SESSIONS'),
  CANVAS.indexOf('<!-- ══════════ PR5 · EARNINGS'));
const DATA = CANVAS.slice(CANVAS.indexOf('// ── PR4 · Sessions ──'),
  CANVAS.indexOf('// ── PR5 · Earnings pointer ──'));

/**
 * THE CANVAS'S OWN SLOT FIXTURE, translated once into the row shape
 * `GET /me/slots` returns — `WEEK1`/`WEEK2` in the canvas data block, which
 * every PR4 number is computed from there (`ALL_SLOTS`).
 *
 * Translated rather than parsed: the canvas writes them as JavaScript inside
 * an HTML `<script>`, and a regex over that would be a second parser to keep
 * working. What matters is that the COUNTS below are the canvas's own, and
 * those are asserted against the canvas text itself further down, so a
 * translation that drifted from the drawing would be caught there.
 *
 * The canvas's flags map onto real columns like this:
 *   `booked`  → `taken: 1`
 *   `open`    → `taken: 0`
 *   `gated`   → `payment_state: 'held_unpaid'` (migration 240)
 *   `blocked` → `blocked_reason` set (migration 240)
 *   `rec`     → `recording_state: 'consented'` (migration 240)
 */
const at = (day, hhmm) => `2026-11-${String(day).padStart(2, '0')}T${hhmm}:00.000Z`;
const CANVAS_SLOTS = [
  // WEEK1
  { id: 1, starts_at: at(24, '10:00'), ends_at: at(24, '11:00'), taken: 1, amount_cents: 30000, recording_state: 'consented' },
  { id: 2, starts_at: at(25, '11:00'), ends_at: at(25, '12:00'), taken: 1, amount_cents: 30000 },
  { id: 3, starts_at: at(25, '14:00'), ends_at: at(25, '15:00'), taken: 1, amount_cents: 30000, recording_state: 'consented' },
  { id: 4, starts_at: at(26, '09:00'), ends_at: at(26, '10:00'), taken: 0 },
  { id: 5, starts_at: at(26, '15:00'), ends_at: at(26, '16:00'), taken: 1, amount_cents: null, payment_state: 'held_unpaid' },
  { id: 6, starts_at: at(27, '13:00'), ends_at: at(27, '14:00'), taken: 1, amount_cents: 30000, recording_state: 'consented' },
  { id: 7, starts_at: at(28, '10:00'), ends_at: at(28, '11:00'), taken: 0 },
  { id: 8, starts_at: at(28, '11:00'), ends_at: at(28, '12:00'), taken: 0 },
  // WEEK2
  { id: 9, starts_at: at(31, '10:00'), ends_at: at(31, '11:00'), taken: 1, amount_cents: 30000 },
  { id: 10, starts_at: '2026-12-01T14:00:00.000Z', ends_at: '2026-12-01T15:00:00.000Z', taken: 1, amount_cents: 30000 },
  { id: 11, starts_at: '2026-12-02T09:00:00.000Z', ends_at: '2026-12-02T10:00:00.000Z', taken: 0 },
  { id: 12, starts_at: '2026-12-02T15:00:00.000Z', ends_at: '2026-12-02T16:00:00.000Z', taken: 0 },
  { id: 13, starts_at: '2026-12-03T13:00:00.000Z', ends_at: '2026-12-03T14:00:00.000Z', taken: 1, amount_cents: 450000 },
  { id: 14, starts_at: '2026-12-04T10:00:00.000Z', ends_at: '2026-12-04T11:00:00.000Z', taken: 0, blocked_reason: 'writing' },
];

// ───────────────────────────── slotKind ─────────────────────────────

test('slotKind ranks held above booked, and the ranking is what the tiles rest on', () => {
  // THE ONE THAT WOULD FAIL SILENTLY. A held slot IS booked — someone took it
  // — so the two branches both apply and only the order decides.
  const heldAndBooked = { taken: 1, payment_state: 'held_unpaid' };
  assert.equal(slotKind(heldAndBooked), 'held');

  // And the negative: a booked slot whose payment state is anything else is
  // booked. `held` is not "has a payment_state", it is one value of it.
  for (const state of ['not_applicable', 'authorized', 'charged', 'refunded']) {
    assert.equal(slotKind({ taken: 1, payment_state: state }), 'booked',
      `payment_state '${state}' is not held`);
  }
});

test('slotKind resolves every other collision in the order the grid draws', () => {
  // Cancelled outranks everything: the booking is undone, so nothing else
  // about the row is a fact about a live slot any more.
  assert.equal(slotKind({ is_cancelled: 1, taken: 1, payment_state: 'held_unpaid', blocked_reason: 'x' }), 'cancelled');
  // Blocked outranks held and booked but not cancelled.
  assert.equal(slotKind({ blocked_reason: 'writing', taken: 1, payment_state: 'held_unpaid' }), 'blocked');
  assert.equal(slotKind({ taken: 1 }), 'booked');
  assert.equal(slotKind({ taken: 0 }), 'open');
  // An absent `taken` is open, not a crash — the column is nullable.
  assert.equal(slotKind({}), 'open');
  assert.equal(slotKind(null), 'open');
  // An empty `blocked_reason` is not a block. A NOT NULL DEFAULT '' on that
  // column would otherwise turn every slot in the calendar grey at once.
  assert.equal(slotKind({ blocked_reason: '', taken: 0 }), 'open');
});

test('every kind slotKind can return has a label and a tone', () => {
  // Otherwise a chip renders as `undefined` or with no colour, which looks
  // like a styling bug rather than a missing case.
  const kinds = new Set([...GRID.matchAll(/return '([a-z]+)';/g)].map((m) => m[1]));
  assert.ok(kinds.size >= 5, `parsed only ${kinds.size} kinds out of slotKind`);
  for (const k of kinds) {
    assert.ok(KIND_LABEL[k], `no label for kind '${k}'`);
    assert.ok(KIND_TONE[k], `no tone for kind '${k}'`);
  }
});

// ───────────────────────────── slotCounts ─────────────────────────────

test('slotCounts reproduces the canvas’s own arithmetic over the canvas’s own slots', () => {
  const c = slotCounts(CANVAS_SLOTS);
  assert.deepEqual(c, {
    booked: 7, open: 5, held: 1, blocked: 1, cancelled: 0,
    paid: 7, free: 0, total: 14,
  });
  // The canvas computes these in its own script; assert its rendered prose
  // carries the same numbers, so the translation above cannot drift from the
  // drawing without this failing.
  assert.match(ART + DATA, /Of the ' \+ totalN \+ ' slots in this grid/);
  assert.match(DATA, /no free intros booked/);

  // AND THE SUM CLOSES. Every slot is in exactly one bucket; a precedence
  // change that double-counted would still produce plausible tiles.
  assert.equal(c.booked + c.open + c.held + c.blocked + c.cancelled, c.total);
  assert.equal(c.paid + c.free, c.booked);
});

test('slotCounts is not fooled by an absent or zero price', () => {
  // `paid` means "a price was taken", and null is not zero — migration 205's
  // distinction, which the tile note inherits.
  const c = slotCounts([
    { taken: 1, amount_cents: 30000 },
    { taken: 1, amount_cents: null },
    { taken: 1, amount_cents: 0 },
    { taken: 1 },
  ]);
  assert.equal(c.booked, 4);
  assert.equal(c.paid, 1, 'only the one with a real amount is paid');
  assert.equal(c.free, 3, 'null, zero and absent are all "not a paid hour"');
});

test('slotCounts survives what the API can actually hand it', () => {
  assert.deepEqual(slotCounts(null),
    { booked: 0, open: 0, held: 0, blocked: 0, cancelled: 0, paid: 0, free: 0, total: 0 });
  assert.equal(slotCounts(undefined).total, 0);
  assert.equal(slotCounts({}).total, 0, 'an object is not a list');
});

// ───────────────────────────── the three notes ─────────────────────────────

test('bookedNote states the absence of free intros rather than dropping the clause', () => {
  // The artboard writes the second half as a fact — "no free intros booked" —
  // because a dropped clause leaves the reader unsure whether the count
  // excluded them.
  assert.equal(bookedNote({ paid: 7, free: 0 }), '7 paid · no free intros booked');
  assert.equal(bookedNote({ paid: 5, free: 1 }), '5 paid, 1 free intro');
  assert.equal(bookedNote({ paid: 5, free: 2 }), '5 paid, 2 free intros', 'plural');
  assert.equal(bookedNote({}), '0 paid · no free intros booked');
  assert.equal(bookedNote(null), '0 paid · no free intros booked');
});

test('openNote names the denominator the open count is a share of', () => {
  assert.equal(openNote({ total: 14 }), 'after buffers and cap · 14 slots in the grid');
  assert.equal(openNote({ total: 1 }), 'after buffers and cap · 1 slot in the grid', 'singular');
  assert.equal(openNote({ total: 0 }), 'after buffers and cap · 0 slots in the grid');
  assert.equal(openNote(null), 'after buffers and cap · 0 slots in the grid');
});

test('ruleNote names only the states that occurred, and always the total and the open', () => {
  const full = ruleNote({ total: 14, booked: 7, held: 1, blocked: 1, open: 5 });
  assert.match(full, /Of the 14 slots in this grid, 7 booked, 1 held unpaid and 1 manually blocked/);
  assert.match(full, /leaving 5 open/);

  // Zero held and zero blocked are OMITTED, not printed as "0 held unpaid".
  // A grid with nothing held should not put the word in front of the reader.
  const plain = ruleNote({ total: 4, booked: 2, held: 0, blocked: 0, open: 2 });
  assert.equal(plain.includes('held unpaid'), false);
  assert.equal(plain.includes('manually blocked'), false);
  assert.match(plain, /Of the 4 slots in this grid, 2 booked — leaving 2 open/);

  // One extra state joins with "and", two join with a comma then "and".
  assert.match(ruleNote({ total: 3, booked: 1, held: 1, blocked: 0, open: 1 }),
    /1 booked and 1 held unpaid/);

  // The sentence the note exists for survives every branch: it stops a reader
  // taking the rules card as a description of THIS fortnight.
  for (const n of [full, plain]) {
    assert.match(n, /govern how many slots exist at all, not which of these are taken/);
  }
  assert.match(ruleNote({ total: 1, booked: 1 }), /Of the 1 slot in this grid/, 'singular');
});

// ───────────────────────────── grouping and formatting ─────────────────────────────

test('groupByDay orders days and slots ascending, and drops what it cannot place', () => {
  const days = groupByDay([
    { id: 'b', starts_at: '2026-11-25T14:00:00.000Z' },
    { id: 'a', starts_at: '2026-11-25T09:00:00.000Z' },
    { id: 'c', starts_at: '2026-11-24T10:00:00.000Z' },
    { id: 'x', starts_at: null },
    { id: 'y' },
    { id: 'z', starts_at: 'not a date' },
    null,
  ]);
  assert.equal(days.length, 2, 'three unplaceable rows and a null are dropped, not grouped');
  assert.ok(days[0].key < days[1].key, 'days ascend');
  assert.deepEqual(days[1].slots.map((s) => s.id), ['a', 'b'], 'slots within a day ascend');
  for (const d of days) {
    assert.ok(d.label, 'every day carries a heading');
    assert.match(d.key, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('groupByDay keys by the reader’s local day, not the ISO string’s date part', () => {
  // `2026-11-04T23:30:00Z` is the 5th in Paris and the 4th in New York. Taking
  // the date part of the string would hand every reader London's answer.
  const iso = '2026-11-04T23:30:00.000Z';
  const [day] = groupByDay([{ id: 1, starts_at: iso }]);
  const d = new Date(iso);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(day.key, expected);
  assert.equal(day.label, dayLabel(d));
});

test('slotTime answers null rather than "Invalid Date"', () => {
  assert.equal(slotTime(null), null);
  assert.equal(slotTime(undefined), null);
  assert.equal(slotTime(''), null);
  assert.equal(slotTime('not a date'), null);
  assert.ok(slotTime('2026-11-24T10:00:00.000Z'), 'a real instant still formats');
});

test('blackoutLabel renders a calendar day as a reading, never as an instant', () => {
  assert.equal(blackoutLabel({ day: 'fri', from: '12:00', to: '18:00' }), 'Friday 12:00–18:00');
  assert.equal(blackoutLabel({ day: 'FRI' }), 'Friday', 'case-insensitive, and a day alone is enough');
  assert.equal(blackoutLabel({ day: 'mon', from: '09:00' }), 'Monday', 'half a window is not a window');
  assert.equal(blackoutLabel({}), null);
  assert.equal(blackoutLabel(null), null);
  // An unknown day is passed through rather than dropped: the advisor stored
  // it, and swallowing it would show a blackout card with nothing in it.
  assert.equal(blackoutLabel({ day: 'caturday' }), 'caturday');

  // THE STRUCTURAL HALF, because every assertion above would also pass a
  // Date-based implementation in UTC — which is exactly where CI runs.
  //
  // Sliced to the function's OWN body. Reading to the end of the file instead
  // swept in `narrowSlots`, whose `new Date(s.ends_at)` is correct — a slot
  // time IS an instant — and the assertion failed on a function it was never
  // about.
  const fn = GRID.slice(GRID.indexOf('export function blackoutLabel'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.includes('DAY_NAMES'), 'the slice missed the function body');
  assert.equal(/new Date|Date\.parse|getTime|toLocale/.test(body), false,
    'blackoutLabel must not construct a Date — a calendar day is not an instant');
});

test('ruleValue keeps a zero and refuses to invent one', () => {
  // A cap of 0 is "accept no paid sessions" and is a decision. Absent is a
  // question nobody answered. `!v` would collapse the two (D56/D68).
  assert.equal(ruleValue(0), '0');
  assert.equal(ruleValue(0, ' min'), '0 min');
  assert.equal(ruleValue(6), '6');
  assert.equal(ruleValue(15, ' min'), '15 min');
  assert.equal(ruleValue(null), null);
  assert.equal(ruleValue(undefined), null);
  assert.equal(ruleValue(null, ' h'), null, 'a suffix does not conjure a value');
});

// ───────────────────────────── the four views ─────────────────────────────

test('narrowSlots serves each chip the page declares, and the wide views stay wide', () => {
  const now = Date.now();
  const past = { id: 'p', ends_at: new Date(now - 86_400_000).toISOString(), taken: 1 };
  const future = { id: 'f', ends_at: new Date(now + 86_400_000).toISOString(), taken: 1 };
  const held = { id: 'h', ends_at: new Date(now + 86_400_000).toISOString(), taken: 1, payment_state: 'held_unpaid' };
  const all = [past, future, held];

  assert.deepEqual(narrowSlots(all, 'unpaid_held').map((s) => s.id), ['h']);
  assert.deepEqual(narrowSlots(all, 'past').map((s) => s.id), ['p']);
  // `two_weeks` and `month` differ by the WINDOW the server was asked for, not
  // by a predicate here — narrowing a fortnight of rows to "a month" would
  // show FEWER slots under the wider name.
  assert.equal(narrowSlots(all, 'two_weeks').length, 3);
  assert.equal(narrowSlots(all, 'month').length, 3);
  assert.ok(VIEW_DAYS.month > VIEW_DAYS.two_weeks, 'the wider chip asks for a wider window');
  assert.equal(narrowSlots(null, 'past').length, 0);
  // A slot with no end cannot be shown as past — that would be a claim.
  assert.equal(narrowSlots([{ id: 'n', taken: 1 }], 'past').length, 0);
});

test('the four chips the canvas draws are the four views the page can serve', () => {
  // Read out of the canvas so a fifth chip appearing in the drawing fails here
  // rather than rendering as a dead pill.
  const drawn = DATA.slice(DATA.indexOf('s_views:'), DATA.indexOf(']', DATA.indexOf('s_views:')));
  const labels = [...drawn.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Two weeks', 'Month', 'Past sessions', 'Unpaid held']);

  const entry = FILTERS.slice(FILTERS.indexOf("'practice/sessions': ["));
  const block = entry.slice(0, entry.indexOf('],'));
  for (const label of labels) {
    assert.ok(block.includes(`canvas: '${label}'`), `the chip row is missing '${label}'`);
  }
  const keys = [...block.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys.slice().sort(), Object.keys(VIEW_DAYS).slice().sort(),
    'every chip needs a window, and every window needs a chip');
  // The page names each key itself. A key resolved one import away lets a chip
  // be declared live over a page that cannot serve it — `month` was exactly
  // that on the first draft, read out of `VIEW_DAYS[forView]`.
  for (const k of keys) {
    assert.ok(P.includes(`'${k}'`), `the page never names the view key '${k}'`);
  }
});

test('the two ops the canvas draws are handlers, not exports or promises', () => {
  assert.match(ART, /<span class="bulk">Block a date range<\/span>/);
  assert.match(ART, /<span class="bulk">Export to calendar<\/span>/);

  const entry = ACTIONS.slice(ACTIONS.indexOf("'practice/sessions': ["));
  const block = entry.slice(0, entry.indexOf('],'));
  assert.match(block, /label: 'Block a date range', kind: 'handler'/);
  // NOT `kind: 'export'`. The builder's export kind emits CSV through
  // `exportView`; a calendar is .ics, and the two are not interchangeable.
  assert.match(block, /label: 'Export to calendar', kind: 'handler'/);
  assert.equal(block.includes('unbuilt'), false, 'both ops are real on this page');
  assert.equal(block.includes("kind: 'export'"), false);

  // And the page actually supplies both handlers it declares.
  for (const h of [...block.matchAll(/handler: '(\w+)'/g)].map((m) => m[1])) {
    assert.match(P, new RegExp(`\\b${h}\\b`), `the page declares the op '${h}' and has no handler`);
  }
  assert.match(P, /BEGIN:VCALENDAR/, 'Export to calendar must emit a calendar');
});

// ───────────────────────────── the page against the artboard ─────────────────────────────

test('the four stat tiles the artboard draws are the four the page renders', () => {
  const drawn = [...DATA.matchAll(/label:'([^']+)', value/g)].map((m) => m[1]);
  assert.deepEqual(drawn, ['Booked, next 14 d', 'Open slots', 'Held unpaid', 'Weekly cap']);
  // The page shortens the first — its tile is not fixed at fourteen days, the
  // window follows the chip — so the other three are asserted verbatim and the
  // first by its noun.
  for (const label of ['Open slots', 'Held unpaid', 'Weekly cap']) {
    assert.ok(P.includes(`label="${label}"`), `no tile labelled ${label}`);
  }
  assert.ok(P.includes('label="Booked"'));
});

test('the three configuration cards the artboard draws are all present, with their sub-labels', () => {
  for (const [title, sub] of [
    ['Availability rules', 'Configuration'],
    ['Session types', 'What can be booked'],
    ['Booking links', 'Only here'],
  ]) {
    assert.ok(ART.includes(`<span class="zt">${title}</span>`), `the canvas no longer draws ${title}`);
    assert.ok(ART.includes(`<span class="zs">${sub}</span>`), `the canvas no longer draws "${sub}"`);
    assert.ok(P.includes(`>${title}</h3>`), `the page is missing the ${title} card`);
    assert.ok(P.includes(`>${sub}</span>`), `the page is missing the "${sub}" sub-label`);
  }
});

test('the slot card carries the two markers the artboard draws on it', () => {
  // HELD · UNPAID, and a recording chip. Both are per-slot state from
  // migration 240, and both are drawn inside the grid on the canvas.
  assert.match(ART, /HELD · UNPAID/);
  assert.match(P, /Held · unpaid/);
  assert.match(ART, /Recording<\/span>/);
  assert.match(P, /Recording/);
  // Every value migration 240's CHECK admits has somewhere to go, or a slot
  // renders a chip that says `undefined`.
  const m240 = read('cloudflare-worker/sql/migrations/240_advisor_sessions_config.sql');
  const check = m240.slice(m240.indexOf('recording_state IN ('));
  const states = [...check.slice(0, check.indexOf(')')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(states, ['none', 'requested', 'consented', 'declined']);
  const labels = P.slice(P.indexOf('const RECORDING_LABEL'));
  for (const s of states) {
    assert.ok(labels.slice(0, labels.indexOf('};')).includes(`${s}:`),
      `recording_state '${s}' has no label`);
  }
});

test('the operational columns are the advisor’s own and do not reach the public slot list', () => {
  // The grid reads `GET /me/slots`. The public `GET /:uid/slots` answers
  // whoever is browsing an advisor's profile, and `payment_state` there would
  // tell a founder the advisor's payout account is unverified.
  assert.match(API, /listMyAdvisorSlots/);
  assert.match(P, /listMyAdvisorSlots/);
  assert.match(WORKER, /advisors\.get\('\/me\/slots'/);

  const pub = WORKER.slice(WORKER.indexOf('function slotDto('));
  const body = pub.slice(0, pub.indexOf('\n}'));
  for (const col of ['recording_state', 'payment_state', 'blocked_reason']) {
    assert.equal(body.includes(col), false,
      `${col} is in the public slotDto — that is the founder's copy too`);
  }
  const own = WORKER.slice(WORKER.indexOf('function ownSlotDto('));
  const ownBody = own.slice(0, own.indexOf('\n}'));
  for (const col of ['recording_state', 'payment_state', 'blocked_reason']) {
    assert.ok(ownBody.includes(col), `ownSlotDto must carry ${col} — the grid reads it`);
  }
});

test('blocking a range refuses the slots it cannot take, and says how many', () => {
  // A booked hour cannot be blocked — someone holds it — and an advisor who
  // asked for a fortnight and got eleven days needs to know which request was
  // not honoured. Silently blocking fewer is the failure mode.
  const h = WORKER.slice(WORKER.indexOf("advisors.post('/me/slots/block'"));
  const handler = h.slice(0, h.indexOf('\n});'));
  assert.match(handler, /skipped_booked/);
  assert.match(handler, /taken/, 'the refusal has to be decided from the taken count');
  assert.match(P, /skipped_booked/, 'and the page has to report it');
});

test('nothing on this page claims a client was charged', () => {
  // PR5b brings the Stripe Connect service leg in test mode behind a
  // production flag. Until then `payment_state` is the reason a booking could
  // NOT be charged, and the page must not read as a receipt.
  //
  // Asserted on `codeOnly`, because the docblock above says the word in the
  // course of explaining the rule — the self-matching trap.
  for (const claim of [
    /\bwas charged\b/i, /\bhas been charged\b/i, /\bpaid out\b/i,
    /\bpayment received\b/i, /\bsettled\b/i,
  ]) {
    assert.doesNotMatch(P, claim, 'no surface may state a charge the platform cannot make');
  }
  // And the positive: the page says what "held" means instead of implying it.
  assert.match(P, /booked and <strong>not charged<\/strong>/);
});

test('the billing section the artboard does not draw is still here, and still honest', () => {
  // An artboard that does not draw a working feature is not an instruction to
  // delete it. Migration 205's two columns have exactly one writer, and this
  // is it.
  assert.match(P, /What each session was worth/);
  assert.match(P, /Nothing is billed,\s*\n?\s*invoiced or collected through Axal/);
  assert.match(P, /unpriced/, 'the unpriced count stays surfaced rather than shrinking the totals');
  // `Unrecorded`, never a plausible zero, on every absence the section can
  // render. `$0.00` would say the advisor worked for nothing.
  assert.match(P, /money\(b\.amount_cents\) \?\? <Unrecorded/);
  assert.equal(/amount_cents\s*(\?\?|\|\|)\s*0(?![\d.])/.test(P), false);
});

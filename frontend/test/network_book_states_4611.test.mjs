/**
 * #4611 findings 8, 9 and 10 — the relationship book's counts, its clock and
 * its read states.
 *
 * Finding 9 is a bug a source test could not have seen and a rendered page
 * can: `contacts.filter(isCold)` is well-formed JavaScript that calls a
 * well-formed function, and it measures every contact against a clock of
 * 0, 1, 2. The first two tests here run the real helpers over real
 * timestamps, which is the only way that shows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLD_AFTER_DAYS, coldBookView, coldestBookDays, isCold } from '../src/lib/networkBook.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const PAGE = read('../src/pages/founder/FounderNetworkRelationships.jsx');
const NOW = Date.parse('2026-11-09T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// Old, recent and unknown activity, as the finding asks for — and ten of them,
// so an index-as-clock bug has indices well past the 60-day window to be wrong
// about.
const BOOK = [
  { id: 1, name: 'Old one', last_activity_at: daysAgo(400) },
  { id: 2, name: 'Recent', last_activity_at: daysAgo(3) },
  { id: 3, name: 'Unknown', last_activity_at: null },
  { id: 4, name: 'Just past', last_activity_at: daysAgo(61) },
  { id: 5, name: 'Just inside', last_activity_at: daysAgo(60) },
  { id: 6, name: 'Older still', last_activity_at: daysAgo(900) },
  { id: 7, name: 'Recent two', last_activity_at: daysAgo(1) },
  { id: 8, name: 'Unparseable', last_activity_at: 'not a date' },
  { id: 9, name: 'Old three', last_activity_at: daysAgo(120) },
  { id: 10, name: 'Today', last_activity_at: daysAgo(0) },
];

test('the cold summary agrees with the per-row flags, on one clock', () => {
  // THE ROWS ARE THE TRUTH: whatever the table's own cell would say.
  const perRow = BOOK.filter((row) => isCold(row, NOW));
  assert.deepEqual(perRow.map((r) => r.id), [1, 4, 6, 9]);

  // The summary, through the array-safe helper. Same records, same clock.
  assert.deepEqual(coldBookView(BOOK, NOW).map((r) => r.id), [1, 4, 6, 9]);
  assert.equal(coldestBookDays(BOOK, NOW), 900);

  // AND THE BUG, REPRODUCED, so this test fails if the call site goes back.
  // `filter` passes `(element, index)`, so `isCold`'s `now` becomes the index
  // — a clock in 1970, against which nothing is more than 60 days old.
  const viaBareFilter = BOOK.filter(isCold);
  assert.deepEqual(viaBareFilter, [], 'the index-as-clock bug no longer reproduces, so this guard is moot');
  assert.notDeepEqual(viaBareFilter.map((r) => r.id), perRow.map((r) => r.id));
});

test('an unknown last activity is not cold, and the window is the canvas\'s 60 days', () => {
  assert.equal(COLD_AFTER_DAYS, 60);
  // 60 is inside, 61 is past: the boundary both ways.
  assert.equal(isCold({ last_activity_at: daysAgo(60) }, NOW), false);
  assert.equal(isCold({ last_activity_at: daysAgo(61) }, NOW), true);
  // Nothing recorded, and nothing parseable, are unknown rather than cold —
  // calling either cold would flag every imported contact on arrival.
  for (const value of [null, undefined, '', 'not a date']) {
    assert.equal(isCold({ last_activity_at: value }, NOW), false, String(value));
  }
  assert.equal(coldestBookDays([{ last_activity_at: null }], NOW), null);
  assert.equal(coldBookView(null, NOW).length, 0);
});

test('the page reads the summary through the array-safe helper, never bare', () => {
  // Mutation checked: put `contacts.filter(isCold)` back and the first test
  // above fails on the summary; this one names the call site so the diff is
  // obvious in review.
  assert.match(PAGE, /const cold = coldBookView\(contacts\);/);
  // The prose above the call site quotes the bug by name, so the check is on
  // code: a bare `isCold` as a filter argument, not the words describing one.
  const code = PAGE.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /\.filter\(isCold\)/, 'isCold is passed bare to filter again');
  assert.match(PAGE, /coldestBookDays\(contacts\)/, 'the Coldest tile re-derives its own maximum');
});

test('the project filter is the Worker\'s, applied before the page', () => {
  // Finding 8: the client used to drop every row whose project_id was not the
  // selected startup, AFTER a 500-row cut made across every startup.
  assert.match(PAGE, /api\.contactsList\(\{ project_id: chosen\.id \}\)/);
  assert.doesNotMatch(PAGE, /all\.filter\(\(row\) => row\.project_id/, 'the page filters by project again, after the page');
  // And with no project there is no read at all, rather than one whose answer
  // would be every project's newest page presented as this one's.
  assert.match(PAGE, /const contactResult = chosen\s*\n\s*\?/);
  // The client passes the filter through.
  const API = read('../src/lib/api.js');
  assert.match(API, /qs\.set\('project_id', String\(opts\.project_id\)\)/);
  assert.match(API, /qs\.set\('cursor', String\(opts\.cursor\)\)/);
});

test('a failed contacts read is unreadable, never a book with nothing in it', () => {
  // Finding 10. The old state machine was `chosen ? 'ready' : …`, so a
  // rejected contacts read with a resolved project rendered a full, zeroed
  // book — "In the book 0", "Going cold 0" — above a table whose empty state
  // asserts that no contact is RECORDED. Zero presented as a figure somebody
  // read.
  assert.match(PAGE, /contactResult\?\.status === 'rejected' \? 'unreadable' : 'ready'/);
  assert.match(PAGE, /data-testid="status-network-relationships-unreadable"/);
  assert.match(PAGE, /This is a failed read of the contacts store, not a startup with no contacts recorded\./);
  assert.match(PAGE, /a zero here would be a figure nobody read/);
  // `null`, not `[]`: an empty array renders exactly as an unread list does.
  assert.match(PAGE, /const \[book, setBook\] = useState\(null\);/);
  assert.doesNotMatch(PAGE, /setContacts\(/, 'the page keeps a rows array that cannot say it was never read');
});

test('every count on the page names its scope', () => {
  // "In the book" is the Worker's whole-startup total; the derived tiles are
  // over the rows loaded and say so. A page figure under a collection's label
  // is the defect.
  assert.match(PAGE, /value=\{book\?\.total \?\? contacts\.length\}/);
  assert.match(PAGE, /function bookScope\(book, knownTypes\)/);
  assert.match(PAGE, /\$\{book\.rows\.length\} loaded of \$\{book\.total\}/);
  assert.match(PAGE, /count unavailable/, 'an unreadable total prints as a number anyway');
  assert.match(PAGE, /of \$\{contacts\.length\} loaded/);
  // And the rest of the book is reachable, or the cursor the Worker returns
  // has no reader.
  assert.match(PAGE, /data-testid="network-relationships-more"/);
  assert.match(PAGE, /const loadMore = async \(\) =>/);
});

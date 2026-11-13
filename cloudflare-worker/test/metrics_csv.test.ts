/**
 * The KPI importer reads a founder's actual spreadsheet, and refuses out loud.
 *
 * WHY THE PARSER IS A SERVICE AND NOT INLINE IN THE ROUTE. Every assertion below
 * is a rejection reason or a coercion, and each one is a sentence a founder will
 * read. Exercising them through a route would need a database, an auth token and a
 * project for each — so most of them would not get written, which is exactly how
 * an importer ends up with one happy path and eleven silent drops.
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE ONES ABOUT WHAT IS *NOT* WRITTEN:
 *
 *   · a blank cell is NULL, never a real zero — `Number('')` is 0 and finite, the
 *     trap #203 shipped once, and here it would put "MRR was $0 in March" into a
 *     series the investor product reads;
 *   · a row whose metrics are all blank is refused rather than written as a month
 *     of nulls, or "months on record" counts rows the import invented;
 *   · a file naming one month twice is refused rather than last-wins, because both
 *     lines look deliberate and a silent pick drops a figure the founder can see;
 *   · the row cap is REPORTED, not applied quietly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planImport, splitCsv, cellToNumber, cellToDay, headerToColumn,
  IMPORT_COLUMNS, IMPORT_MAX_ROWS,
} from '../src/services/metricsCsv.ts';

// ── splitting ─────────────────────────────────────────────────────────────────

test('CRLF is one row break, not two', () => {
  // Counting it twice inserts a blank row between every real one, and every other
  // line is then refused as empty — on precisely the files Excel writes.
  assert.deepEqual(splitCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(splitCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('a quoted field keeps its commas, newlines and doubled quotes', () => {
  assert.deepEqual(splitCsv('a,"1,200"'), [['a', '1,200']]);
  assert.deepEqual(splitCsv('a,"line\nbreak"'), [['a', 'line\nbreak']]);
  assert.deepEqual(splitCsv('a,"say ""hi"""'), [['a', 'say "hi"']]);
});

test('a file with no trailing newline still has its last row', () => {
  // Dropping it loses whichever month the founder typed last, which is the one
  // they are most likely to check for.
  assert.deepEqual(splitCsv('month,mrr\n2026-08,100'), [['month', 'mrr'], ['2026-08', '100']]);
});

// ── headers ───────────────────────────────────────────────────────────────────

test('the header spellings a real export uses are recognised', () => {
  assert.equal(headerToColumn('MRR'), 'mrr');
  assert.equal(headerToColumn('Monthly Recurring Revenue'), 'mrr');
  assert.equal(headerToColumn('month'), 'snapshot_date');
  assert.equal(headerToColumn('Date'), 'snapshot_date');
  assert.equal(headerToColumn('Net burn'), 'net_burn');
  assert.equal(headerToColumn('net_burn'), 'net_burn');
  assert.equal(headerToColumn('Churn %'), 'monthly_churn_pct');
  assert.equal(headerToColumn('Cash balance'), 'cash_balance');
  assert.equal(headerToColumn('NRR'), 'nrr_pct');
  assert.equal(headerToColumn('Something else'), null);
});

test("Excel's byte-order mark does not hide the first column", () => {
  // A BOM in front of the first cell would make the header something that matches
  // no alias, and the symptom is "every row is missing its date" on the files most
  // founders have.
  //
  // `trim()` IS WHAT HANDLES IT. U+FEFF is <ZWNBSP>, part of the spec's WhiteSpace
  // production, so trimming removes it — verified against node rather than assumed.
  // This test exists because a mutation sweep showed the explicit `.replace()` that
  // used to sit beside the trim was redundant AND held the BOM as an invisible
  // literal character in the source, where an editor or a reformat could eat it and
  // leave a regex matching everything. Every BOM below is written as an ESCAPE for
  // the same reason.
  assert.equal(headerToColumn('\uFEFFmonth'), 'snapshot_date');
  assert.equal(headerToColumn('\uFEFFMRR'), 'mrr');
  assert.equal(headerToColumn('\uFEFFnet_burn'), 'net_burn');
  assert.equal(headerToColumn('mrr\uFEFF'), 'mrr');
  // AND IN THE MIDDLE OF A HEADER TOO, which surprised the first version of this
  // test. `\s` in a JS regex matches U+FEFF, so the `squashed` pass that removes
  // spaces and underscores removes a stray BOM as well. That is the right answer
  // rather than a lucky one: nothing else `m…rr` could mean, and the alternative is
  // refusing a column over a byte no human can see in their own spreadsheet.
  assert.equal(headerToColumn('m\uFEFFrr'), 'mrr');
  assert.equal(headerToColumn('Net\uFEFF burn'), 'net_burn');
  // `notes` IS THE ONE HEADER THAT NEEDS THE TRIM, and a mutation sweep found it.
  // The others survive a missing trim by accident: the squash pass that removes
  // spaces and underscores also removes a BOM, and `mrr` squashed is still `mrr`.
  // `notes` is matched by an exact `lower === 'notes'` check with no alias and no
  // entry in the column map, so without the trim a BOM'd or padded `notes` column
  // reads as unrecognised — a founder's annotation silently ignored.
  assert.equal(headerToColumn('\uFEFFnotes'), 'notes');
  assert.equal(headerToColumn('  notes  '), 'notes');
  assert.equal(headerToColumn('\uFEFFsnapshot_date'), 'snapshot_date');
});

test('every column the importer can set is a column the series has', () => {
  // The list is the writer's contract with `project_metrics`. A key here that the
  // table lacks makes the INSERT throw at runtime with a row count already
  // reported to the founder.
  for (const key of Object.keys(IMPORT_COLUMNS)) {
    assert.equal(headerToColumn(key), key, `${key} is not recognised as its own header`);
  }
  assert.equal(Object.keys(IMPORT_COLUMNS).length, 12);
});

// ── cells ─────────────────────────────────────────────────────────────────────

test('a blank cell is NULL and never a real zero', () => {
  // THE ASSERTION THIS MODULE EXISTS FOR. `Number('')` is 0 and `Number.isFinite(0)`
  // is true, so a coercion that ran before the emptiness check writes "$0 MRR" for
  // a month nobody measured — and every derived figure above it is then wrong.
  assert.equal(cellToNumber(''), null);
  assert.equal(cellToNumber('   '), null);
  assert.equal(cellToNumber(null), null);
  assert.equal(cellToNumber(undefined), null);
  // And the three ways a person writes "not recorded".
  assert.equal(cellToNumber('—'), null);
  assert.equal(cellToNumber('-'), null);
  assert.equal(cellToNumber('n/a'), null);
  assert.equal(cellToNumber('N/A'), null);
  // A real zero is still a real zero.
  assert.equal(cellToNumber('0'), 0);
  assert.equal(cellToNumber('0.0'), 0);
});

test('the notation a spreadsheet actually holds parses', () => {
  assert.equal(cellToNumber('$104,800'), 104800);
  assert.equal(cellToNumber('104800'), 104800);
  assert.equal(cellToNumber('1.2%'), 1.2);
  assert.equal(cellToNumber('£61,200'), 61200);
  assert.equal(cellToNumber('€1 200'), 1200);
  // Accounting parentheses are negative. A burn written `(61,200)` read as
  // positive would flip the sign on the one metric where the sign is the point.
  assert.equal(cellToNumber('(61,200)'), -61200);
  assert.equal(cellToNumber('-4.5'), -4.5);
  assert.equal(cellToNumber('+12'), 12);
});

test('a cell that is not a number is refused rather than guessed', () => {
  for (const bad of ['about 100k', '100k', '1.2.3', 'twelve', '$', '%', '--5']) {
    assert.equal(cellToNumber(bad), 'bad', `accepted ${JSON.stringify(bad)} as a number`);
  }
});

test('a month cell becomes the first of that month, and an ambiguous one is refused', () => {
  assert.equal(cellToDay('2026-08'), '2026-08-01');
  assert.equal(cellToDay('2026-8'), '2026-08-01');
  assert.equal(cellToDay('2026-08-21'), '2026-08-21');
  assert.equal(cellToDay('08/2026'), '2026-08-01');
  assert.equal(cellToDay('Aug 2026'), '2026-08-01');
  assert.equal(cellToDay('August 2026'), '2026-08-01');
  assert.equal(cellToDay('Aug. 2026'), '2026-08-01');
  // `08/02/2026` is February in one country and August in another. Refused rather
  // than resolved: a date the platform picked is a row filed against a month that
  // may not have happened.
  assert.equal(cellToDay('08/02/2026'), null);
  assert.equal(cellToDay('21 Aug 2026'), null);
  assert.equal(cellToDay(''), null);
  // A month that does not exist, and a day that does not exist in its month.
  assert.equal(cellToDay('2026-13'), null);
  assert.equal(cellToDay('2026-00'), null);
  assert.equal(cellToDay('2026-02-30'), null);
  assert.equal(cellToDay('2026-04-31'), null);
});

test('a month outside 1-12 is refused, though no test can prove the check is there', () => {
  assert.equal(cellToDay('2026-13'), null);
  assert.equal(cellToDay('2026-00'), null);
  assert.equal(cellToDay('13/2026'), null);
  assert.equal(cellToDay('00/2026'), null);
  // AN EQUIVALENT MUTANT, RECORDED SO NOBODY TRIES TO CLOSE IT. Removing
  // `month < 1 || month > 12` from `validDay` changes nothing observable: the
  // length lookup below it is `lengths[month - 1]`, and `lengths[12]` and
  // `lengths[-1]` are both `undefined` — `1 <= undefined` is `false`, verified
  // against node. So the month is refused either way. The explicit range check
  // stays because a date validator should STATE the rule rather than rely on an
  // out-of-bounds comparison happening to be falsy.
});

test('February 29 exists in a leap year and not otherwise', () => {
  // 2024 is a leap year, 2026 is not, 2000 is (divisible by 400), 1900 is not
  // (divisible by 100 but not 400) — the rule written out rather than approximated
  // as `% 4`, because a Date constructor would have silently rolled the 29th into
  // March instead of refusing it.
  assert.equal(cellToDay('2024-02-29'), '2024-02-29');
  assert.equal(cellToDay('2026-02-29'), null);
  assert.equal(cellToDay('2000-02-29'), '2000-02-29');
  assert.equal(cellToDay('1900-02-29'), null);
});

// ── the plan ──────────────────────────────────────────────────────────────────

test('a clean two-month file plans two rows and refuses nothing', () => {
  const plan = planImport('month,MRR,Net burn,Headcount\n2026-07,98400,58000,4\n2026-08,"104,800","61,200",4\n');
  assert.deepEqual(plan.rejected, []);
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.rows.map((r) => r.snapshot_date), ['2026-07-01', '2026-08-01']);
  assert.equal(plan.rows[1].values.mrr, 104800);
  assert.equal(plan.rows[1].values.net_burn, 61200);
  assert.equal(plan.rows[1].values.headcount, 4);
});

test('a count column is rounded and a money column is not', () => {
  const plan = planImport('month,headcount,mrr\n2026-08,4.6,104800.55\n');
  // `headcount` is INTEGER in migration 249. SQLite would accept 4.6 in it and
  // nothing downstream would question a fractional person.
  assert.equal(plan.rows[0].values.headcount, 5);
  assert.equal(plan.rows[0].values.mrr, 104800.55);
});

test('a file with no month column is refused at the header, with a reason naming the fix', () => {
  const plan = planImport('MRR,Net burn\n98400,58000\n');
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].line, 1);
  assert.match(plan.rejected[0].reason, /month, date, period, snapshot_date/);
});

test('a file with a month column and no metric column is refused', () => {
  const plan = planImport('month,notes\n2026-08,hello\n');
  assert.equal(plan.rows.length, 0);
  assert.match(plan.rejected[0].reason, /no metric column recognised/);
});

test('an empty file is refused rather than reported as zero rows written', () => {
  for (const empty of ['', '   ', '\n\n', ',,\n,,']) {
    const plan = planImport(empty);
    assert.equal(plan.rows.length, 0);
    assert.ok(plan.rejected.length >= 1, `"${empty}" produced no rejection`);
  }
});

test('a row whose metrics are all blank is refused, not written as a month of nulls', () => {
  const plan = planImport('month,mrr,net_burn\n2026-07,98400,58000\n2026-08,,\n');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].snapshot_date, '2026-07-01');
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].line, 3);
  assert.match(plan.rejected[0].reason, /every metric on this row is blank/);
});

test('a partly blank row is written, with the blanks as NULL', () => {
  const plan = planImport('month,mrr,net_burn,headcount\n2026-08,104800,,4\n');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].values.mrr, 104800);
  // NULL, and emphatically not 0 — the burn was not measured, not zero.
  assert.equal(plan.rows[0].values.net_burn, null);
  assert.equal(plan.rows[0].values.headcount, 4);
});

test('a bad value refuses its own row and names the column and the cell', () => {
  const plan = planImport('month,mrr,net_burn\n2026-07,98400,58000\n2026-08,about 100k,61200\n');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rejected[0].line, 3);
  assert.match(plan.rejected[0].reason, /mrr is not a number: "about 100k"/);
});

test('a bad month refuses its own row and quotes what was in the cell', () => {
  const plan = planImport('month,mrr\nQ3 2026,98400\n2026-08,104800\n');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].snapshot_date, '2026-08-01');
  assert.equal(plan.rejected[0].line, 2);
  assert.match(plan.rejected[0].reason, /"Q3 2026" is not a month/);
});

test('one bad row does not cost the rest of the file', () => {
  const plan = planImport(
    'month,mrr\n2026-06,90000\nnonsense,1\n2026-07,98400\n2026-08,oops\n2026-09,110000\n',
  );
  // THE WHOLE DESIGN IN ONE ASSERTION. A parser that threw on the first bad line
  // would make a founder fix fourteen months one at a time; one that dropped them
  // silently would lose two months they can see in their own file.
  assert.deepEqual(plan.rows.map((r) => r.snapshot_date), ['2026-06-01', '2026-07-01', '2026-09-01']);
  assert.deepEqual(plan.rejected.map((r) => r.line), [3, 5]);
});

test('a file naming one month twice is refused, not last-wins', () => {
  const plan = planImport('month,mrr\n2026-08,98400\n2026-08-01,104800\n');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].values.mrr, 98400);
  assert.equal(plan.rejected.length, 1);
  // The message names the EARLIER line, so the founder can compare the two rows
  // rather than hunt for the duplicate.
  assert.match(plan.rejected[0].reason, /2026-08-01 is already on line 2/);
});

test('an unrecognised column is reported as ignored rather than silently skipped', () => {
  const plan = planImport('month,mrr,Gross margin,Vibes\n2026-08,104800,72,high\n');
  assert.deepEqual(plan.ignored, ['Gross margin', 'Vibes']);
  assert.equal(plan.rows.length, 1);
  // The recognised columns still land. A file is not refused for carrying extra.
  assert.equal(plan.rows[0].values.mrr, 104800);
});

test('the row cap is reported line by line, never applied quietly', () => {
  const lines = ['month,mrr'];
  for (let i = 0; i < IMPORT_MAX_ROWS + 3; i += 1) {
    const y = 2000 + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, '0');
    lines.push(`${y}-${m},${1000 + i}`);
  }
  const plan = planImport(lines.join('\n'));
  assert.equal(plan.rows.length, IMPORT_MAX_ROWS);
  assert.equal(plan.rejected.length, 3);
  // A truncation nobody is told about reads as "everything was imported", which is
  // the failure this whole module's docblock is about.
  for (const r of plan.rejected) assert.match(r.reason, /over the \d+-row limit/);
});

test('a blank line in the middle of a file is skipped without a rejection', () => {
  // A trailing blank row or a separator line is not an error a founder needs to
  // read about — it is how spreadsheets end.
  const plan = planImport('month,mrr\n2026-07,98400\n\n2026-08,104800\n\n');
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.rejected, []);
});

test('a notes column rides along and is not treated as a metric', () => {
  const plan = planImport('month,mrr,notes\n2026-08,104800,"Contractor month, not recurring"\n');
  assert.equal(plan.rows[0].notes, 'Contractor month, not recurring');
  // `notes` alone would not satisfy the "at least one metric" check, which is why
  // it is mapped but excluded from `IMPORT_COLUMNS`.
  assert.ok(!Object.prototype.hasOwnProperty.call(IMPORT_COLUMNS, 'notes'));
  const notesOnly = planImport('month,notes\n2026-08,hello\n');
  assert.equal(notesOnly.rows.length, 0);
});

test('the line numbers are the file’s, header included', () => {
  const plan = planImport('month,mrr\n2026-07,98400\n2026-08,104800\n');
  // Line 2 and 3, not row 0 and 1. Reporting a zero-based data index would name a
  // different line than the founder's editor shows.
  assert.deepEqual(plan.rows.map((r) => r.line), [2, 3]);
});

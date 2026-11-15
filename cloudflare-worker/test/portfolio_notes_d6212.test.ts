/**
 * D6212 (#6212): the material behind the Portfolio notes on Performance and the Overview.
 *
 * The model only ever sees what `portfolioNoteMaterial` returns, so the rules live there and are tested there:
 * every figure carries its date, gap quarters are named as gaps, and an empty book is [] (which the draft route
 * answers with `nothing_to_draft` before any model call; that ordering is held below on the route's source).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completedQuarterEnds, quarterLabel, portfolioNoteMaterial, PORTFOLIO_NOTE_INSTRUCTION } from '../src/services/portfolioNotes.ts';
import { railOptionJob } from '../src/services/ai/textJobs.ts';

const TODAY = '2026-11-15';

test('completed quarter-ends: the last N before today, oldest first, across a year boundary', () => {
  assert.deepEqual(completedQuarterEnds(TODAY, 2), ['2026-06-30', '2026-09-30']);
  assert.deepEqual(completedQuarterEnds('2026-01-05', 2), ['2025-09-30', '2025-12-31']);
  assert.deepEqual(completedQuarterEnds('2026-03-31', 1), ['2025-12-31'], 'a quarter is not complete on its last day');
  assert.equal(completedQuarterEnds(TODAY, 8).length, 8);
  assert.deepEqual(completedQuarterEnds('nonsense', 2), []);
  assert.deepEqual(completedQuarterEnds(TODAY, 0), []);
  assert.equal(quarterLabel('2026-09-30'), 'Q3 2026');
});

test('nothing recorded is nothing to explain: no position, or none at a completed quarter-end, is []', () => {
  assert.deepEqual(portfolioNoteMaterial({ positions: [], distributions: [], marks: [], today: TODAY, quarters: 8 }), []);
  const onlyThisQuarter = [{ project_id: 1, project_name: 'Acme', invested_amount: 100000, position_date: '2026-10-20' }];
  assert.deepEqual(portfolioNoteMaterial({ positions: onlyThisQuarter, distributions: [], marks: [], today: TODAY, quarters: 8 }), []);
  const zero = [{ project_id: 1, invested_amount: 0, position_date: '2025-01-10' }];
  assert.deepEqual(portfolioNoteMaterial({ positions: zero, distributions: [], marks: [], today: TODAY, quarters: 8 }), []);
});

const book = {
  positions: [
    { project_id: 1, project_name: 'Acme', invested_amount: 100000, position_date: '2026-02-01' },
    { project_id: 2, project_name: 'Borealis', invested_amount: 50000, position_date: '2026-08-15' },
  ],
  distributions: [{ project_id: 1, project_name: 'Acme', amount: 20000, distribution_date: '2026-08-01' }],
  marks: [
    { project_id: 1, project_name: 'Acme', as_of_date: '2026-03-31', fmv: 120000, basis: 'round_price', event: 'Series A' },
    { project_id: 1, project_name: 'Acme', as_of_date: '2026-09-15', fmv: 150000, basis: null },
  ],
};

test('each quarter-end reads only records dated on or before it, with paid-in, distributed, NAV, TVPI and DPI', () => {
  const lines = portfolioNoteMaterial({ ...book, today: TODAY, quarters: 3 });
  assert.match(lines[0], /gross of fees and carry/);
  const q1 = lines.find((l) => l.startsWith('Q1 2026'))!;
  assert.match(q1, /paid-in \$100,000; distributed \$0; NAV \$120,000; TVPI 1\.20x; DPI 0\.00x; 1 of 1 position carried at a recorded mark\./);
  const q3 = lines.find((l) => l.startsWith('Q3 2026'))!;
  // Borealis has no mark: carried at cost. Acme's September mark counts; the distribution counts.
  assert.match(q3, /paid-in \$150,000; distributed \$20,000; NAV \$200,000; TVPI 1\.47x; DPI 0\.13x; 1 of 2 positions carried at a recorded mark, 1 at cost\./);
});

test('events are cited with their dates, and a mark with no basis says UNRECORDED', () => {
  const lines = portfolioNoteMaterial({ ...book, today: TODAY, quarters: 3 }).join('\n');
  assert.match(lines, /mark: Acme, 2026-09-15, FMV \$150,000, basis UNRECORDED/);
  assert.match(lines, /distribution: Acme, 2026-08-01, \$20,000/);
  assert.match(lines, /cheque: Borealis, 2026-08-15, \$50,000/);
});

test('a gap quarter is named as a gap: no book, or a book with nothing recorded in the quarter', () => {
  const lines = portfolioNoteMaterial({ ...book, today: TODAY, quarters: 4 });
  // Q4 2025 precedes the first cheque.
  assert.ok(lines.some((l) => l === 'Q4 2025 (quarter-end 2025-12-31): NO RECORDED BOOK. This quarter-end is a gap, not a zero.'));
  // Q2 2026 holds Acme but nothing happened in it.
  const i = lines.findIndex((l) => l.startsWith('Q2 2026'));
  assert.match(lines[i + 1], /no mark, distribution or cheque is recorded in Q2 2026: a gap in the record\. Never describe this quarter as flat or steady\./);
});

test('the first quarter-end read is the starting point: nothing before it is cited as inside it', () => {
  const lines = portfolioNoteMaterial({ ...book, today: TODAY, quarters: 2 }); // Q2 and Q3 2026
  const q2 = lines.findIndex((l) => l.startsWith('Q2 2026'));
  assert.match(lines[q2 + 1], /starting point/);
  assert.ok(!lines.join('\n').includes('2026-03-31, FMV'), 'Q1\'s mark is not an event of the window');
});

test('an unusable mark carries at cost and is counted apart', () => {
  const lines = portfolioNoteMaterial({
    positions: [{ project_id: 1, invested_amount: 100, position_date: '2026-01-02' }],
    distributions: [], marks: [{ project_id: 1, as_of_date: '2026-02-01', fmv: -5, basis: 'write_down' }],
    today: TODAY, quarters: 1,
  });
  assert.match(lines.join('\n'), /NAV \$100; TVPI 1\.00x; DPI 0\.00x; 0 of 1 position carried at a recorded mark, 1 at cost\./);
});

test('the instruction names the gaps, keeps marks apart from cash, cites dates and never tells the reader what to do', () => {
  assert.match(PORTFOLIO_NOTE_INSTRUCTION, /gap/);
  assert.match(PORTFOLIO_NOTE_INSTRUCTION, /never add an unrealised value to a realised one/);
  assert.match(PORTFOLIO_NOTE_INSTRUCTION, /quarter-end or the event date/);
  assert.match(PORTFOLIO_NOTE_INSTRUCTION, /do not forecast/);
  assert.doesNotMatch(PORTFOLIO_NOTE_INSTRUCTION, /recommend|advice|advise/i);
});

test('the two surfaces are registered, use the builder, and the route refuses before any model call', () => {
  const src = readFileSync(new URL('../src/routes/research.ts', import.meta.url), 'utf8');
  assert.match(src, /'portfolio\/performance': \{\s*instruction: PORTFOLIO_NOTE_INSTRUCTION,\s*gather: async \(c, userId\) => portfolioNoteGather\(c, userId, 8\)/);
  assert.match(src, /'portfolio\/overview': \{\s*instruction: PORTFOLIO_NOTE_INSTRUCTION,\s*gather: async \(c, userId\) => portfolioNoteGather\(c, userId, 2\)/);
  const post = src.slice(src.indexOf("research.post('/drafts'"));
  assert.ok(post.indexOf("'nothing_to_draft'") > 0 && post.indexOf("'nothing_to_draft'") < post.indexOf('runAI('), 'empty material is refused before the model');
  const gather = src.slice(src.indexOf('async function portfolioNoteGather'), src.indexOf('const DRAFT_SURFACES'));
  assert.match(gather, /if \(ids != null && ids\.length === 0\) return \[\];/, 'an empty accessible book is never an unscoped read');
  assert.match(gather, /licence === 'partner' \|\| licence === 'investor'/);
});

test('both options run the numbers job the multiple narrative runs', () => {
  assert.equal(railOptionJob('Investor · Portfolio · Performance', 'draft:performance-note'), 'IN5');
  assert.equal(railOptionJob('Investor · Portfolio', 'draft:portfolio-read'), 'IN5');
});

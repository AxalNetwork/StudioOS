/**
 * #4531 (slice 1): the judge's missing-data rule is field-specific, and a case
 * may assert numbers by metric, value, unit and tolerance. Every assertion has
 * a known-correct candidate and a targeted incorrect one. The draft and the
 * published paths are covered in hq_skill_lifecycle_d4160 and
 * agent_skill_runs_d1612d, which run the real `judge()` through `runCase()`.
 *
 * All text below is made up for the test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCase, judge, type CaseExpect } from '../src/services/agents/skillLifecycle.ts';
import { JUDGE_VERSION, missingDataMiss, statements } from '../src/services/agents/skillAssertions.ts';
import { SKILL_LIBRARY } from '../src/services/agents/skillLibrary.generated.ts';

const BOARD = SKILL_LIBRARY.find((e) => e.slug === 'board-meeting-brief')!.cases[0].expect as unknown as CaseExpect;
const verdict = (e: CaseExpect, out: string) => judge(e, out).result;

test('the demonstrated regression: an unrelated "Not recorded" does not cover runway', () => {
  assert.equal(JUDGE_VERSION, 2);
  assert.deepEqual(BOARD.must_say_not_recorded, ['runway'], 'the committed case is the one the issue names');
  const r = judge(BOARD, 'There are 37 paying customers. Delaware franchise tax is on the agenda. Runway is 12 months. Churn is Not recorded.');
  assert.deepEqual(r, { result: 'fail', detail: 'It did not say runway is not recorded.' });
});

test('runway stated as not recorded passes, in a sentence, a list item, a Field: value line and a table row', () => {
  const lead = 'There are 37 paying customers. Delaware franchise tax is on the agenda.';
  for (const out of [
    `${lead} Runway is not recorded.`,
    `${lead}\n- Runway: Not recorded`,
    `${lead}\nRunway: Not recorded`,
    `| Item | Value |\n| --- | --- |\n| Customers | 37 |\n| Runway | Not recorded |\nDelaware franchise tax is on the agenda.`,
    `${lead} Runway is not recorded, because burn for 2026 is missing.`,
    `${lead} Runway: Not recorded; burn: Not recorded.`,
  ]) assert.equal(verdict(BOARD, out), 'pass', out);
});

test('runway omitted, only another field missing, or missing and also given a value: each fails', () => {
  const lead = 'There are 37 paying customers. Delaware franchise tax is on the agenda.';
  assert.equal(verdict(BOARD, lead), 'fail', 'omitted');
  assert.equal(verdict(BOARD, `${lead} Churn is Not recorded.`), 'fail', 'only an unrelated field');
  assert.equal(verdict(BOARD, `${lead} Runway is mentioned. Burn: Not recorded.`), 'fail', 'the field named, the mark elsewhere');
  const both = judge(BOARD, `${lead} Runway is not recorded. Runway is 12 months.`);
  assert.deepEqual(both, { result: 'fail', detail: 'It said runway is not recorded and also gave it a value.' });
  assert.equal(verdict(BOARD, `${lead}\nRunway: Not recorded\nRunway: 12 months`), 'fail', 'a list that contradicts itself');
});

test('the field is matched as a word; a hypothetical figure is not an invented value', () => {
  assert.equal(missingDataMiss('runway', statements('Runways: Not recorded')), 'It did not say runway is not recorded.');
  assert.equal(missingDataMiss('runway', statements('Runway: Not recorded. If runway were 12 months we could hire.')), null);
  assert.equal(missingDataMiss('monthly burn', statements('Monthly burn is not recorded.')), null);
  assert.equal(missingDataMiss('monthly burn', statements('Burn is not recorded.')), 'It did not say monthly burn is not recorded.');
});

test('statements: lines and sentences, never at a decimal point', () => {
  assert.deepEqual(statements('DPI: 0.20x; RVPI: 0.90x.\nTVPI 1.10x'), ['dpi: 0.20x;', 'rvpi: 0.90x.', 'tvpi 1.10x']);
});

const FUND: CaseExpect = {
  output: 'brief', must_include: [], must_say_not_recorded: [], must_not_include: [],
  numbers: [
    { metric: 'DPI', value: 0.2, unit: 'x', tolerance: 0.005 },
    { metric: 'RVPI', value: 0.9, unit: 'x', tolerance: 0.005 },
    { metric: 'TVPI', value: 1.1, unit: 'x', tolerance: 0.005 },
  ],
};

test('numbers: the documented equivalent forms pass', () => {
  for (const out of [
    'DPI: 0.20x; RVPI: 0.90x; TVPI: 1.10x',
    'DPI 0.20x, RVPI 0.9x and TVPI is 1.10 x.',
    'DPI = 0.2x. RVPI of 0.90x. TVPI was 1.10x.',
    '| Metric | Value |\n| --- | --- |\n| DPI | 0.20x |\n| RVPI | 0.90x |\n| TVPI | 1.10x |',
  ]) assert.equal(verdict(FUND, out), 'pass', out);
});

test('numbers: a wrong value, a wrong unit, swapped labels, a contradiction, a missing metric or a hypothetical fails', () => {
  const cases: Array<[string, string]> = [
    ['DPI: 0.25x; RVPI: 0.90x; TVPI: 1.10x', 'It gave DPI as 0.25x, not 0.2x.'],
    ['DPI: 0.20%; RVPI: 0.90x; TVPI: 1.10x', 'It gave DPI in "%", not "x".'],
    ['DPI: 0.20; RVPI: 0.90x; TVPI: 1.10x', 'It gave DPI in "no unit", not "x".'],
    ['DPI: 0.90x; RVPI: 0.20x; TVPI: 1.10x', 'It gave DPI as 0.9x, not 0.2x.'],
    ['DPI: 0.20x; RVPI: 0.90x; TVPI: 1.10x. Later DPI is 0.35x.', 'It gave DPI as 0.35x, not 0.2x.'],
    ['RVPI: 0.90x; TVPI: 1.10x', 'It did not state DPI 0.2x.'],
    // A conditional statement is not the fact, even in a form that would otherwise match.
    ['If DPI is 0.20x, RVPI is 0.90x and TVPI is 1.10x, the fund is on plan.', 'It did not state DPI 0.2x.'],
  ];
  for (const [out, detail] of cases) assert.deepEqual(judge(FUND, out), { result: 'fail', detail }, out);
});

test('numbers: tolerance is inclusive; a unitless figure is matched without its next word', () => {
  const one: CaseExpect = { ...FUND, numbers: [{ metric: 'DPI', value: 0.2, unit: 'x', tolerance: 0.01 }] };
  assert.equal(verdict(one, 'DPI 0.21x'), 'pass');
  assert.equal(verdict(one, 'DPI 0.22x'), 'fail');
  const count: CaseExpect = { ...FUND, numbers: [{ metric: 'paying customers', value: 37, unit: '', tolerance: 0 }] };
  assert.equal(verdict(count, 'Paying customers: 37 this month.'), 'pass');
  assert.equal(verdict(count, 'Paying customers: 370.'), 'fail', 'a substring of the figure is not the figure');
  assert.equal(verdict(count, 'Paying customers: 37k.'), 'fail');
});

test('checkCase: numbers are validated, kept, and absent when a case has none', () => {
  const base = { name: 'Fund metrics', input: { records: { 'raise.records': { dpi: 0.2 } } } };
  const ok = checkCase({ ...base, expect: { output: 'brief', numbers: FUND.numbers } });
  assert.equal(ok.ok, true, 'a case with only numbers is a case');
  if (ok.ok) assert.deepEqual(ok.expect.numbers, FUND.numbers);
  const plain = checkCase({ ...base, expect: { output: 'brief', must_include: ['DPI'] } });
  assert.equal(plain.ok && 'numbers' in plain.expect, false, 'a v1 case is stored as before');
  for (const bad of [
    [{ metric: '', value: 1, unit: 'x', tolerance: 0 }],
    [{ metric: 'DPI', value: Number.NaN, unit: 'x', tolerance: 0 }],
    [{ metric: 'DPI', value: '0.2', unit: 'x', tolerance: 0 }],
    [{ metric: 'DPI', value: 0.2, tolerance: 0 }],
    [{ metric: 'DPI', value: 0.2, unit: 'x', tolerance: -1 }],
    [{ metric: 'DPI', value: 0.2, unit: 'x x', tolerance: 0 }],
    Array.from({ length: 21 }, () => ({ metric: 'DPI', value: 0.2, unit: 'x', tolerance: 0 })),
    'DPI 0.2x',
  ]) {
    const r = checkCase({ ...base, expect: { output: 'brief', must_include: ['DPI'], numbers: bad } });
    assert.equal(r.ok, false, JSON.stringify(bad).slice(0, 80));
  }
});

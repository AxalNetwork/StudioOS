/**
 * D6862 (#6862, D6021 V17/V18) — Record a decision's E-numbered evidence table,
 * its coverage sentence and the rules the Eadwyn task card draws by
 * (`verdictEvidenceModel.js`), and where the two new parts are registered.
 * Every row and name is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/verdict_evidence_6862.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cardState, coverage, dayMonth, offeredRows, reasoningText, scopeWord, sharedDecisionPath, staleness, summaryGroups, towardWord,
} from '../src/pages/cycles/verdictEvidenceModel.js';

const fields = [
  { name: 'for', options: [{ value: 'venture', label: 'The venture' }, { value: 'h-2', label: 'H2 · They will pay' }] },
  { name: 'evidence', options: [
    { value: 'a', label: 'Jo Sample · no budget · H2 · They will pay · Anecdote', hypothesis_id: 2, source: 'interview:1', direction: 'contradicts', strength: 'anecdote', kind: 'interview', meta: '21 Oct' },
    { value: 'x', label: 'Other claim row · H1 · Claim', hypothesis_id: 1, source: 'interview:9', direction: 'supports', kind: 'interview' },
    { value: 'b', label: 'Waitlist request · H2 · They will pay', hypothesis_id: 2, source: 'signal:s', direction: 'supports', kind: 'signal' },
    { value: 'c', label: 'Jo Sample again · H2 · They will pay', hypothesis_id: 2, source: 'interview:1', direction: 'contradicts', kind: 'interview' },
    { value: 'd', label: 'Pricing page · H2 · They will pay', hypothesis_id: 2, source: 'experiment:5', direction: 'supports', kind: 'experiment', observed: false },
    { value: 'e', label: 'Unchecked row · H2 · They will pay', hypothesis_id: 2, source: 'interview:3', direction: 'supports', kind: 'interview' },
  ] },
];
const values = { for: 'h-2', evidence: ['a', 'b', 'c', 'd', 'x'] };

test('offeredRows numbers only the scope’s rows and says what each does toward the bar', () => {
  const rows = offeredRows(fields, values);
  assert.deepEqual(rows.map((r) => [r.n, r.key, r.toward]), [
    [1, 'a', 'counted'], [2, 'b', 'counted'], [3, 'c', 'duplicate_source'], [4, 'd', 'no_observed_result'], [5, 'e', 'not_checked'],
  ]);
  assert.equal(rows[0].label, 'Jo Sample');
  assert.equal(rows[0].strength, 'Anecdote');
  assert.equal(rows[1].strength, null, 'a strength the Worker did not send is null, drawn as Not recorded');
  assert.equal(rows[0].direction, 'contradicts');
  assert.equal(towardWord(rows[2]), 'Same source as another link (E1)');
  assert.equal(towardWord(rows[3]), 'No observed result recorded yet');
  assert.equal(towardWord(rows[0]), null);
  assert.equal(scopeWord(fields, values), 'H2');
  // The venture scope offers every row.
  assert.equal(offeredRows(fields, { for: 'venture', evidence: [] }).length, 6);
  assert.equal(scopeWord(fields, { for: 'venture' }), 'the venture');
});

test('the coverage sentence names counted sources and what recording now would keep', () => {
  const rows = offeredRows(fields, values);
  const c = coverage(rows, 'H2');
  assert.equal(c.lead, '2 of 5');
  assert.equal(c.text, ' distinct sources counted for H2 (1 interview, 1 demand signal). ');
  assert.equal(c.tail, 'A decision recorded now would be kept as Withheld.');
  assert.equal(coverage(rows, 'H2', 2).tail, 'A decision recorded now would be given.');
});

test('the summary’s lines cite rows of the table only, and its text never chooses', () => {
  const rows = offeredRows(fields, values);
  const result = {
    rows: [
      { key: 'a', group: 'contradicts', text: 'No budget for a tool', reason: null },
      { key: 'zzz', group: 'supports', text: 'A row this table does not hold', reason: null },
      { key: 'b', group: 'supports', text: 'Would try it next quarter', reason: null },
      { key: 'c', group: 'not_counted', text: 'Same person', reason: 'duplicate_source' },
      { key: 'b', group: 'proceed', text: 'Not a group', reason: null },
    ],
    keys: ['a', 'b', 'c', 'd'],
    change: { code: 'H2', disproof: null, success_bar: '3 of 10 ask for a trial', deadline: '2026-11-30' },
  };
  const g = summaryGroups(result, rows);
  assert.deepEqual(g.contradicts.map((l) => l.n), [1]);
  assert.deepEqual(g.supports.map((l) => l.n), [2]);
  assert.deepEqual(g.not_counted.map((l) => [l.n, l.reason]), [[3, 'Same source as another link']]);
  const text = reasoningText(result, rows, 'H2');
  assert.match(text, /^Contradicts \(1 row\):\n- E1 No budget for a tool\nSupports \(1 row\):\n- E2 Would try it next quarter\nChecked but not counted:\n- E3 Same person \(Same source as another link\)\nWhat would change this \(H2\):\n- Disproof: Not recorded\n- Success bar: 3 of 10 ask for a trial, by 2026-11-30$/);
  assert.ok(!/\b(proceed|pivot|stop)\b/i.test(text));
});

test('out of date when the checked rows change after the read ran', () => {
  const rows = offeredRows(fields, values);
  assert.equal(staleness({ keys: ['a', 'b', 'c', 'd'] }, rows), null);
  const more = offeredRows(fields, { ...values, evidence: [...values.evidence, 'e'] });
  const s = staleness({ keys: ['a', 'b', 'c', 'd'] }, more);
  assert.deepEqual([s.added.map((r) => r.n), s.removed], [[5], 0]);
  assert.equal(staleness({ keys: ['a', 'b', 'c', 'd', 'gone'] }, rows).removed, 1);
});

test('the task card’s seven states', () => {
  const rows = offeredRows(fields, values);
  const none = offeredRows(fields, { for: 'h-99', evidence: [] });
  assert.equal(cardState({ rows: none }), 'none');
  assert.equal(cardState({ rows: offeredRows(fields, { for: 'h-2', evidence: [] }) }), 'unchecked');
  assert.equal(cardState({ rows, quote: { ai: true, hold_microusd: 40000 } }), 'idle');
  assert.equal(cardState({ rows, quote: { ai: false, reason: 'assist_off' } }), 'off');
  assert.equal(cardState({ rows, quote: { ai: false, reason: 'budget_user_month' } }), 'unavailable');
  assert.equal(cardState({ rows, run: { status: 'reading' } }), 'reading');
  assert.equal(cardState({ rows, run: { status: 'failed', code: 'assist_off' } }), 'off');
  assert.equal(cardState({ rows, run: { status: 'failed', code: 'model_unavailable', unavailable: true } }), 'unavailable');
  assert.equal(cardState({ rows, run: { status: 'failed', code: 'evidence_unreadable' } }), 'failed');
  assert.equal(cardState({ rows, run: { status: 'ready', result: { keys: ['a', 'b', 'c', 'd'] } } }), 'ready');
  assert.equal(cardState({ rows, run: { status: 'ready', result: { keys: ['a'] } } }), 'stale');
});

test('dates, the recipient path, and where the two parts are registered', async () => {
  assert.equal(dayMonth('2026-11-13 10:00:00'), '13 Nov');
  assert.equal(dayMonth(null), null);
  assert.equal(sharedDecisionPath(7), '/shared/decisions/7');
  const assistants = readFileSync(new URL('../src/pages/cycles/formAssistants.js', import.meta.url), 'utf8');
  assert.match(assistants, /\['validate\/verdict\/decision', VerdictEvidencePanel\]/);
  const extras = readFileSync(new URL('../src/pages/cycles/recordSectionExtras.js', import.meta.url), 'utf8');
  assert.match(extras, /record\?\.module === 'verdict' && section\?\.key === 'memo'/);
  const route = readFileSync(new URL('../src/routes/sharedDecisions.jsx', import.meta.url), 'utf8');
  assert.match(route, /<Route path="\/shared\/decisions\/:id" element=\{authOnly\(<SharedDecisionPage \/>\)\} \/>/);
});

test('the panel draws the E-numbered table, the coverage sentence and the not-run task', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: VerdictEvidencePanel } = await import('../src/pages/cycles/VerdictEvidencePanel.jsx');
  const render = (v) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(VerdictEvidencePanel, { fields, values: v, setValue: () => {}, busy: false, search: '?project_id=3' })));
  const html = render(values);
  assert.match(html, /Evidence this decision can rest on/);
  assert.match(html, /id="vev-1"/);
  assert.match(html, />E5</);
  assert.match(html, /2 of 5<\/b> distinct sources counted for H2/);
  assert.match(html, /data-state="idle"/);
  assert.match(html, /It never picks a decision\./);
  assert.ok(!/>(Proceed|Pivot|Stop)</.test(html), 'the panel offers no decision button');
  const none = render({ for: 'h-99', evidence: [] });
  assert.match(none, /data-state="none"/);
  assert.match(none, /Go to Hypotheses/);
});

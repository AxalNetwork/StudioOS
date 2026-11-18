/**
 * D6016 (#6016): Validate v2's Hypotheses list (V7) and one hypothesis's evidence (V8), from the reads that exist.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hypotheses_v7_v8_6016.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { METHOD_WORD, METHOD_BY_CLAIM_WORD, relationshipsCell, sourcesCell, splitClaim, CARDS } from '../src/pages/cycles/adapters/validate.js';
import { hypothesisRecordView } from '../src/pages/cycles/hypothesisRecord.js';
import HypothesisRecord from '../src/pages/cycles/HypothesisRecord.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const WORKER_COLS = ['Code', 'Claim', 'Evidence state', 'Relationships', 'Distinct sources', 'Sprint', 'Owner', 'Source'];
const row = (r) => ({ id: 7, hypothesis: 'H2 · They will pay €300 a month', status: 'contested', moved: null, evidence: 2, strength: 'anecdote',
  supporting: 1, contradicting: 1, fit_unrecorded: 2, both: 0, interviews: 2, interviewees: 2, organizations: 2,
  linked_evidence: { interview: 0, signal: 1, metric: 0, experiment: 0 }, sprint: 'Sprint 4', owner: 'Mia L.', provenance: null, ...r });
const list = (rows, filters) => adaptRecords('validate', 'experiments', { cols: WORKER_COLS, rows, total: rows.length, filters });

test('V7: the canvas columns, the claim split from its code, the methodology state', () => {
  const records = list([row()]);
  assert.deepEqual(records.cols.map((c) => c.label), ['Code', 'Claim', 'Evidence state', 'Relationships', 'Distinct sources', 'Sprint', 'Owner', 'Source']);
  const cells = records.rows[0].cells;
  assert.equal(cells.code, 'H2');
  assert.equal(cells.claim, 'They will pay €300 a month');
  assert.deepEqual(cells.status, { text: 'Mixed', tone: 'warn' });
  assert.equal(records.rows[0].recordId, '7', 'the row still opens the hypothesis');
  assert.deepEqual(splitClaim('No code here'), [null, 'No code here']);
});

test('V7: support, contradiction and unknown fit together, each a word with a glyph; relationships are not sources', () => {
  assert.equal(relationshipsCell(row()), '↑ 1 supports · ↓ 1 contradicts · ? 2 fit unknown');
  assert.equal(relationshipsCell(row({ fit_unrecorded: 0 })), '↑ 1 supports · ↓ 1 contradicts');
  assert.equal(sourcesCell(row()), '2 interviews · 2 organizations · 1 signal');
  assert.equal(sourcesCell(row({ organizations: null })), '2 interviews · 1 signal', 'an unrecorded breadth is left out, never 0');
});

test('V7: nothing read is never 0, and no single validated percentage is drawn', () => {
  assert.equal(relationshipsCell({}), null);
  assert.equal(relationshipsCell({ supporting: 0, contradicting: 0, fit_unrecorded: 0 }), null);
  assert.equal(sourcesCell({}), null);
  const records = list([row(), row({ id: 8, status: 'supported' })]);
  assert.doesNotMatch(JSON.stringify(records), /%/);
  assert.doesNotMatch(JSON.stringify(CARDS.experiments({ statuses: { untested: 1, testing: 2, supported: 1, contested: 1, refuted: 0 } })), /%|Contested|Refuted|Untested/);
});

test('V7: the methodology words win, in the cells and the filter, and cover every state the Worker sends', () => {
  const worker = read('cloudflare-worker/src/services/records/validate.ts');
  const claim = worker.match(/const CLAIM: Record<ClaimStatus, \[string, string\]> = \{([\s\S]*?)\};/)[1];
  const keys = [...claim.matchAll(/(\w+): \['([^']+)'/g)];
  assert.ok(keys.length >= 7);
  for (const [, key, word] of keys) {
    assert.ok(METHOD_WORD[key], `${key} has a methodology word`);
    assert.equal(METHOD_BY_CLAIM_WORD[word], METHOD_WORD[key], `the record's "${word}" reads ${METHOD_WORD[key]}`);
  }
  assert.deepEqual([METHOD_WORD.contested, METHOD_WORD.refuted, METHOD_WORD.untested], ['Mixed', 'Contradicted', 'Not started']);
  const filters = list([], [{ key: 'status', label: 'Status', options: [{ value: 'contested', label: 'Contested' }, { value: 'retired', label: 'Retired' }] }]).filters;
  assert.deepEqual(filters[0], { key: 'status', label: 'Evidence state', options: [{ value: 'contested', label: 'Mixed' }, { value: 'retired', label: 'Retired' }] });
});

const record = {
  title: 'They will pay €300 a month', sub: 'Owner Mia L. · deadline 15 Nov',
  pills: [{ text: 'Contested', tone: 'amb' }, { text: 'Sprint 4', tone: 'grey' }],
  facts: [{ label: 'Interview support', value: '1 for · 1 against · 2 fit not recorded · 2 interviews' }],
  main: [
    { key: 'evidence', title: 'Evidence', action: 'add-evidence', empty: 'No evidence linked yet.', rows: [
      { a: 'Waitlist request with price shown', b: 'Demand signal · 29 Oct', c: 'Supports · Anecdote', tone: 'vio', action: { key: 'evidence-strength', body: { link: 'evidence-1' } } },
      { a: 'Interview with Jonas', b: 'Interview · 21 Oct', c: 'Supports · Measured', tone: 'ok', action: { key: 'evidence-strength', body: { link: 'pain-2' } } },
      { a: 'No standalone budget', b: 'Interview · 21 Oct', c: 'Contradicts · Anecdote', tone: 'bad', action: { key: 'evidence-strength', body: { link: 'pain-3' } } },
    ] },
    { key: 'experiments', title: 'Experiments', action: 'add-experiment', rows: [{ a: 'Pricing page with €300 plan', b: 'Landing page', c: 'Done', tone: 'ok' }] },
  ],
  side: [],
  actions: [
    { key: 'record-decision', label: 'Record a decision', kind: 'link', href: '/validate/verdict/new?project=9&for=h-7' },
    { key: 'edit', label: 'Edit', kind: 'form', tone: 'primary', form: { title: 'Edit hypothesis', fields: [] } },
    { key: 'add-evidence', label: 'Add evidence', kind: 'form', form: { title: 'Add evidence', fields: [] } },
    { key: 'unlink', label: 'Unlink evidence', kind: 'form', form: { title: 'Unlink evidence', fields: [] } },
    { key: 'evidence-strength', label: 'Change strength', kind: 'form', form: { title: 'Change strength', fields: [] } },
  ],
};

test('V8: the computed state and the founder decision apart; evidence split by direction; everything else as read', () => {
  const { record: view, standing } = hypothesisRecordView(record);
  assert.deepEqual(standing.state, { text: 'Mixed', tone: 'amb' });
  assert.deepEqual(standing.decision, { label: 'Record a decision', href: '/validate/verdict/new?project=9&for=h-7' });
  assert.deepEqual(view.pills, [{ text: 'Sprint 4', tone: 'grey' }], 'the computed state is not a header pill beside the decision');
  assert.deepEqual(view.main.map((s) => [s.key, s.title, s.rows.length, s.action ?? null]), [
    ['evidence-supporting', '↑ Supporting · 2', 2, 'add-evidence'],
    ['evidence-contradicting', '↓ Contradictory · 1', 1, null],
    ['experiments', 'Experiments', 1, 'add-experiment'],
  ]);
  assert.deepEqual(view.main[1].rows.map((r) => r.a), ['No standalone budget'], 'only the contradicting row is under Contradictory');
  assert.deepEqual(view.main[0].rows.map((r) => r.a), ['Waitlist request with price shown', 'Interview with Jonas']);
  assert.deepEqual(view.actions, record.actions, 'every action stays: edit, add, unlink, change strength, record a decision');
  assert.equal(hypothesisRecordView({ ...record, pills: [{ text: 'Retired', tone: 'grey' }] }).standing.state.text, 'Retired');
  const empty = hypothesisRecordView({ ...record, main: [{ key: 'evidence', title: 'Evidence', rows: [], empty: 'No evidence linked yet.' }] });
  assert.deepEqual(empty.record.main.map((s) => s.key), ['evidence'], 'with no evidence the one section keeps its empty line');
});

test('V8 renders: the two labels, the split, the actions, no percentage', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(HypothesisRecord, { read: record, cycleName: 'Validate', moduleName: 'Experiments and evidence' })));
  assert.match(html, /Computed evidence state<\/span><span[^>]*>Mixed<\/span><span[^>]*>from linked evidence, not proof/);
  assert.match(html, /data-testid="hypothesis-founder-decision"[^>]*><span[^>]*>Founder decision<\/span><span[^>]*>recorded in Verdict<\/span><a[^>]*href="\/validate\/verdict\/new\?project=9&amp;for=h-7"/);
  assert.match(html, /↑ Supporting · 2/);
  assert.match(html, /↓ Contradictory · 1/);
  for (const label of ['Edit', 'Add evidence', 'Unlink evidence']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /%/);
  assert.doesNotMatch(html, />Contested</, 'the old word is gone');
});

test('the split\'s key is the Worker\'s own tone: a contradicting evidence row is `bad`, every other row is not', () => {
  const worker = read('cloudflare-worker/src/services/records/validate.ts');
  assert.match(worker, /tone: e\.direction === 'contradicts' \? 'bad' : e\.strength === 'measured' \? 'ok' : 'vio',/);
  assert.match(read('frontend/src/pages/cycles/defs/validate.jsx'), /experiments: \(read, ctx\) => <div className="space-y-3">\n\s+<HypothesisRecord read=\{read\} \{\.\.\.ctx\} \/>/);
});

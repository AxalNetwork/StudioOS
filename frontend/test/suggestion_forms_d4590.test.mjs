/**
 * D4590 (#4590) — an interview suggestion is edited in labelled fields, never
 * JSON: the form model (`suggestionForms.js`) and the panel's row
 * (`ValidateSections.jsx`'s SuggestionRow). The Worker's side of the same
 * rules is `cloudflare-worker/test/suggestion_forms_d4590.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/suggestion_forms_d4590.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck, propsOf, textOf } from './_form_d695.mjs';
import * as forms from '../src/pages/cycles/suggestionForms.js';
import * as sections from '../src/pages/cycles/ValidateSections.jsx';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// Made-up suggestions, in #1925's `moduleSuggestions` shape.
const BUDGET = {
  id: 51, kind: 'budget', payload: { detail: 'Team budget for tooling', amount_cents: 120050, currency: 'usd', period: 'month' },
  quote: 'we have about twelve hundred a month', interviewee: 'Rowan Vale', interview_id: 7, session_id: 3, cite_from: 1000, segment_id: null, speaker: null, href: null,
};
const EVIDENCE = {
  id: 52, kind: 'evidence', payload: { hypothesis_id: 5, pain_group_id: 9, direction: 'supports', strength: 'anecdote' },
  evidence_context: { hypothesis: { code: 'H1', claim: 'Controllers buy it' }, pain_group: { title: 'Month-end close' } },
  quote: null, interviewee: null, interview_id: 8, session_id: 3, cite_from: null, segment_id: null, speaker: null, href: null,
};
const NEED = {
  id: 53, kind: 'demand_signal', payload: { signal: 'need_to_have', detail: 'Cannot close without it' },
  quote: null, interviewee: null, interview_id: 8, session_id: null, cite_from: null, segment_id: null, speaker: null, href: null,
};
const MYSTERY = {
  id: 54, kind: 'mystery_kind', payload: { anything: 1 }, quote: null, interviewee: null, interview_id: 8, session_id: null,
  cite_from: null, segment_id: null, speaker: null, href: null,
};

// ---------------------------------------------------------------------------
// 1. The form model
// ---------------------------------------------------------------------------

function verifyModel(m) {
  // A payload as a draft, and back: cents as units, the currency in capitals.
  const draft = m.draftFrom('budget', BUDGET.payload);
  assert.deepEqual(draft, { detail: 'Team budget for tooling', amount: '1200.5', currency: 'USD', period: 'month' });
  assert.deepEqual(m.payloadFrom('budget', draft).payload, BUDGET.payload);
  assert.deepEqual(m.payloadFrom('timing', { when: '  Next   quarter ' }).payload, { when: 'Next quarter' }, 'spaces tidied as the Worker does');

  // An empty optional field is left out; a required one is named.
  assert.deepEqual(m.payloadFrom('urgency', { level: 'high', reason: '' }), { payload: { level: 'high' }, errors: {} });
  assert.deepEqual(m.payloadFrom('job_to_be_done', { job: '  ' }), { payload: null, errors: { job: 'Job to be done is needed.' } });
  assert.deepEqual(m.payloadFrom('icp_fit', { fit: '', reason: 'x' }).errors, { fit: 'Choose fit with your ideal customer.' });
  assert.equal(m.payloadFrom('icp_fit', { fit: 'great', reason: 'x' }).errors.fit, 'Choose one of the listed fit with your ideal customer values.');
  assert.equal(m.payloadFrom('timing', { when: 'a'.repeat(121) }).errors.when, 'When is at most 120 characters; this is 121.');
  assert.ok(m.payloadFrom('timing', { when: 'a'.repeat(120) }).payload, 'the limit itself is allowed');

  // An amount: a number above zero, a three-letter currency, never half an amount.
  assert.equal(m.payloadFrom('budget', { detail: 'x', amount: '12,00' }).errors.amount, 'Write the amount as a number above zero, like 1200 or 49.99.');
  assert.equal(m.payloadFrom('budget', { detail: 'x', amount: '0' }).errors.amount, 'Write the amount as a number above zero, like 1200 or 49.99.');
  assert.equal(m.payloadFrom('budget', { detail: 'x', amount: '5', currency: 'US' }).errors.currency, 'A currency is three letters, like USD or EUR.');
  assert.equal(m.payloadFrom('budget', { detail: 'x', currency: 'eur' }).errors.amount, 'Add the amount, or clear the currency and period.');
  assert.deepEqual(m.payloadFrom('budget', { detail: 'x', amount: '49.99', currency: 'Eur' }).payload, { detail: 'x', amount_cents: 4999, currency: 'eur' });

  // A need-to-have names no amount: the fields are hidden and nothing is sent.
  assert.deepEqual(m.visibleFields('demand_signal', { signal: 'need_to_have' }).map((f) => f.key), ['signal', 'detail']);
  assert.deepEqual(m.visibleFields('demand_signal', { signal: 'would_pay' }).map((f) => f.key), ['signal', 'detail', 'amount', 'currency', 'period']);
  assert.deepEqual(m.payloadFrom('demand_signal', { signal: 'need_to_have', detail: '', amount: '5', currency: 'usd' }).payload, { signal: 'need_to_have' });

  // The hypothesis and theme it points at are carried, never typed.
  assert.deepEqual(m.payloadFrom('evidence', { direction: 'refutes', strength: 'pattern' }, EVIDENCE.payload).payload,
    { direction: 'refutes', strength: 'pattern', hypothesis_id: 5, pain_group_id: 9 });
  assert.deepEqual(m.visibleFields('evidence', {}).map((f) => f.key), ['direction', 'strength']);

  // An unknown kind cannot be edited here.
  assert.equal(m.editableKind('mystery_kind'), false);
  assert.equal(m.editableKind('budget'), true);
  assert.equal(m.payloadFrom('mystery_kind', {}).payload, null);
  assert.deepEqual(m.visibleFields('mystery_kind', {}), []);

  // What accepting writes to, in the module's own name.
  assert.equal(m.affectsLine(EVIDENCE), 'Accepting writes to Experiments and evidence · hypothesis H1 · Controllers buy it · theme Month-end close');
  assert.equal(m.affectsLine({ kind: 'evidence', payload: { hypothesis_id: 5 } }), 'Accepting writes to Experiments and evidence · hypothesis #5');
  assert.equal(m.affectsLine(BUDGET), 'Accepting writes to Demand and urgency signals');
  assert.equal(m.affectsLine({ kind: 'firmographic', payload: {} }, { attribute: 'role' }), 'Accepting writes to Customer research');
  assert.equal(m.affectsLine({ kind: 'firmographic', payload: {} }, { attribute: 'tools' }), 'Accepting writes to Ideal customer profile');
  assert.equal(m.affectsLine(MYSTERY), null);
}

test('1: the form model: drafts, payloads, plain-language errors, hidden amounts, kept ids, the module named', async () => {
  verifyModel(forms);
  await mutationCheck(src('pages/cycles/suggestionForms.js'), 'pages/cycles/suggestionForms.js', verifyModel, [
    ['String(cents / 100)', 'String(cents)'],
    ['payload.currency = v.toLowerCase();', 'payload.currency = v;'],
    ['if (f.required) errors[f.key]', 'if (false) errors[f.key]'],
    ['if (v.length > f.max)', 'if (v.length > f.max + 50)'],
    ['for (const k of spec.keeps || [])', 'for (const k of [])'],
    ["d.signal === 'need_to_have' ?", "d.signal === 'never' ?"],
    ['if (!f.options.some(([value]) => value === v))', 'if (false)'],
    ["'demand-signals': 'Demand and urgency signals'", "'demand-signals': 'Demand signals'"],
    [".trim().replace(/\\s+/g, ' ');", ';'],
    ["if (payload.amount_cents == null && (payload.currency || payload.period) && !errors.amount)", 'if (false)'],
    ['Number(v) <= 0', 'Number(v) < 0'],
    ['/^[a-z]{3}$/i.test(v)', '/^[a-z]{2,3}$/i.test(v)'],
  ]);
});

// ---------------------------------------------------------------------------
// 2. The row: labelled fields, errors, cancel, a refused accept, an unknown kind
// ---------------------------------------------------------------------------

const rowNode = (m, id, testid) => m.nodes().find((n) => propsOf(n)['data-testid'] === testid
  && (() => { for (let p = n.parentNode; p; p = p.parentNode) if (propsOf(p)['data-id'] === id) return true; return false; })());
const press = (m, node) => act(async () => { assert.ok(node, 'the button is drawn'); await propsOf(node).onClick({ preventDefault() {} }); });
const type = (m, key, value) => act(async () => propsOf(m.by(`validate-suggestion-input-${key}`)).onChange({ target: { value } }));
const valueOf = (m, key) => propsOf(m.by(`validate-suggestion-input-${key}`)).value;
const panel = (M, rows, onAccept) => h(M.FromYourInterviews, {
  parts: { can_write: true, suggestions: rows }, onAccept, onDiscard: async () => {}, onAcceptAll() {},
});

async function verifyRow(M) {
  const calls = [];
  let refuse = false;
  const m = await mountForm(panel(M, [BUDGET, EVIDENCE, NEED, MYSTERY], async (...a) => { calls.push(a); if (refuse) throw new Error('That module refused it.'); }));
  try {
    // Edit opens labelled fields, one per field of the kind, never JSON.
    await press(m, rowNode(m, 51, 'validate-suggestion-edit'));
    const fields = m.nodes().filter((n) => propsOf(n)['data-testid'] === 'validate-suggestion-field').map((n) => propsOf(n)['data-key']);
    assert.deepEqual(fields, ['detail', 'amount', 'currency', 'period']);
    assert.ok(!m.by('validate-suggestion-draft'), 'no JSON box');
    assert.doesNotMatch(m.text(), /JSON|\{"/);
    for (const key of fields) {
      const input = m.by(`validate-suggestion-input-${key}`);
      const label = m.nodes().find((n) => n.tagName === 'LABEL' && propsOf(n).htmlFor === propsOf(input).id);
      assert.ok(Boolean(label && textOf(label).trim()), `${key} has a label`);
    }
    assert.equal(valueOf(m, 'amount'), '1200.5');
    assert.equal(valueOf(m, 'currency'), 'USD');
    assert.ok(m.text().includes('As suggested'), 'the suggestion as heard stays, marked as the source');
    assert.ok(m.text().includes('Your version'));
    assert.ok(m.text().includes('we have about twelve hundred a month'), 'the quote stays');
    assert.equal(textOf(m.by('validate-suggestion-affects')), 'Accepting writes to Demand and urgency signals.');

    // A broken field sends nothing, and says which and why.
    await type(m, 'detail', '');
    await type(m, 'amount', 'twelve');
    await press(m, rowNode(m, 51, 'validate-suggestion-accept'));
    assert.deepEqual(calls, [], 'nothing was sent');
    assert.ok(m.text().includes('2 fields need a change. Nothing was accepted.'));
    assert.equal(textOf(m.by('validate-suggestion-error-detail')), 'Budget, as said is needed.');
    assert.equal(propsOf(m.by('validate-suggestion-input-detail'))['aria-invalid'], 'true');
    assert.ok(String(propsOf(m.by('validate-suggestion-input-detail'))['aria-describedby']).includes(propsOf(m.by('validate-suggestion-error-detail')).id), 'the error is described');
    assert.equal(propsOf(m.by('validate-suggestion-input-period'))['aria-invalid'], undefined);

    // Cancel puts the suggestion back as it was.
    await press(m, rowNode(m, 51, 'validate-suggestion-edit'));
    assert.ok(!m.by('validate-suggestion-form'), 'Cancel closes the form');
    assert.doesNotMatch(m.text(), /need a change/);
    await press(m, rowNode(m, 51, 'validate-suggestion-edit'));
    assert.equal(valueOf(m, 'detail'), 'Team budget for tooling');
    assert.equal(valueOf(m, 'amount'), '1200.5');

    // A refused accept keeps the edit, and the suggestion stays.
    refuse = true;
    await type(m, 'amount', '1500');
    await press(m, rowNode(m, 51, 'validate-suggestion-accept'));
    assert.deepEqual(calls.at(-1), [51, { detail: 'Team budget for tooling', amount_cents: 150000, currency: 'usd', period: 'month' }]);
    assert.ok(m.text().includes('That module refused it. It is still suggested, and your edits are kept.'));
    assert.equal(valueOf(m, 'amount'), '1500', 'the edit is kept');
    assert.ok(rowNode(m, 51, 'validate-suggestion-form'), 'the form stays open');
    await press(m, rowNode(m, 51, 'validate-suggestion-edit'));
    refuse = false;

    // Evidence: the hypothesis and theme are named and carried, not typed.
    await press(m, rowNode(m, 52, 'validate-suggestion-edit'));
    assert.ok(!m.by('validate-suggestion-input-hypothesis_id'), 'the hypothesis is not a field');
    assert.equal(textOf(m.by('validate-suggestion-affects')), 'Accepting writes to Experiments and evidence · hypothesis H1 · Controllers buy it · theme Month-end close.');
    await type(m, 'direction', 'refutes');
    await press(m, rowNode(m, 52, 'validate-suggestion-accept'));
    assert.deepEqual(calls.at(-1), [52, { direction: 'refutes', strength: 'anecdote', hypothesis_id: 5, pain_group_id: 9 }]);
    await press(m, rowNode(m, 52, 'validate-suggestion-edit'));

    // A need-to-have shows no amount until it is something else.
    await press(m, rowNode(m, 53, 'validate-suggestion-edit'));
    assert.ok(!m.by('validate-suggestion-input-amount'), 'a need-to-have shows no amount');
    await type(m, 'signal', 'would_pay');
    assert.ok(m.by('validate-suggestion-input-amount'), 'an amount once it names a price');
    await press(m, rowNode(m, 53, 'validate-suggestion-edit'));

    // An unknown kind: no Edit, an honest note, and Accept as suggested.
    assert.ok(!rowNode(m, 54, 'validate-suggestion-edit'), 'an unknown kind has no Edit');
    assert.ok(rowNode(m, 54, 'validate-suggestion-not-editable'), 'the note is drawn');
    assert.ok(!rowNode(m, 51, 'validate-suggestion-not-editable'), 'a known kind has no such note');
    await press(m, rowNode(m, 54, 'validate-suggestion-accept'));
    assert.deepEqual(calls.at(-1), [54, undefined]);
  } finally { await m.unmount(); }
}

test('2: Edit draws labelled fields; a broken one sends nothing; Cancel resets; a refused accept keeps the edit; an unknown kind is not editable', async () => {
  await verifyRow(sections);
  await mutationCheck(src('pages/cycles/ValidateSections.jsx'), 'pages/cycles/ValidateSections.jsx', verifyRow, [
    ['const cancel = () => { setEditing(false); setDraft(draftFrom(s.kind, s.payload)); setFieldErrors({}); };', 'const cancel = () => { setEditing(false); setFieldErrors({}); };'],
    ['if (!payload) return undefined;', ''],
    ['{editable && (', '{true && ('],
    ["'aria-invalid': error ? 'true' : undefined", "'aria-invalid': undefined"],
    ['<label htmlFor={id}', '<label'],
    ['{affectsLine(s, draft)}.', '.'],
    ['{visibleFields(s.kind, draft).map((f) => (', '{visibleFields(s.kind, {}).map((f) => ('],
  ]);
});

test('2: while an accept is in flight, every button is disabled and Accept says Saving', async () => {
  let release;
  const m = await mountForm(panel(sections, [BUDGET], () => new Promise((r) => { release = r; })));
  try {
    let pending;
    await act(async () => { pending = propsOf(rowNode(m, 51, 'validate-suggestion-accept')).onClick({}); });
    assert.equal(textOf(rowNode(m, 51, 'validate-suggestion-accept')), 'Saving…');
    for (const id of ['validate-suggestion-accept', 'validate-suggestion-edit', 'validate-suggestion-discard']) assert.equal(propsOf(rowNode(m, 51, id)).disabled, true, id);
    await act(async () => { release(); await pending; });
    assert.equal(textOf(rowNode(m, 51, 'validate-suggestion-accept')), 'Accept');
  } finally { await m.unmount(); }
});

test('2: a stored value the list does not have is drawn as itself and must be changed before accepting', async () => {
  const OLD = { ...BUDGET, id: 55, kind: 'pain_severity', payload: { phrase: 'Month-end takes a week', severity: 'terrible' } };
  const calls = [];
  const m = await mountForm(panel(sections, [OLD], async (...a) => { calls.push(a); }));
  try {
    await press(m, rowNode(m, 55, 'validate-suggestion-edit'));
    const select = m.by('validate-suggestion-input-severity');
    assert.equal(propsOf(select).value, 'terrible');
    assert.ok(textOf(select).includes('terrible (not a listed value)'), 'drawn as itself');
    await press(m, rowNode(m, 55, 'validate-suggestion-accept'));
    assert.deepEqual(calls, [], 'nothing was sent');
    assert.equal(textOf(m.by('validate-suggestion-error-severity')), 'Choose one of the listed severity values.');
    await type(m, 'severity', 'severe');
    await press(m, rowNode(m, 55, 'validate-suggestion-accept'));
    assert.deepEqual(calls, [[55, { phrase: 'Month-end takes a week', severity: 'severe' }]]);
  } finally { await m.unmount(); }
});

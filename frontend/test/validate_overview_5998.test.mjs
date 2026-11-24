/**
 * D5998 (#5998) — Validate Overview V2 (boards V1, V2, V13) on D5996's read.
 *
 *   1. the model turns each part into what the page draws, Not recorded never 0, and nothing invented;
 *   2. desktop V1: objective → one next action → evidence → needs attention → recent changes → hypotheses,
 *      exactly one primary action, and every figure names its population and window;
 *   3. V13 states: one part failing leaves the others; loading, refused, unreadable; an empty venture is one
 *      Still to establish list; a reader and a read-only page get no write;
 *   4. V2: below 1024px the phone root, with the objective above the next action, three attention items, the
 *      evidence from 768px and two hypothesis cards, and no table.
 *
 * Mutation checked (each broke the named tests, then was restored): see the PR's Testing section.
 *
 * Every name is made up. Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_overview_5998.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ValidateOverview from '../src/pages/cycles/ValidateOverview.jsx';
import { attentionView, changesView, evidenceView, hypothesesView, partState, shortDay, stillToEstablish } from '../src/pages/cycles/validateOverviewModel.js';
import validateDef from '../src/pages/cycles/defs/validate.jsx';

const h = React.createElement;
const Q = '?project=7';

const FOCUS = { rule: 'review', eyebrow: 'Validate · Next', headline: 'Review 2 interviews', why: 'Their findings do not count until you review them.', cta: { label: 'Review interviews', href: `/validate/customer-research${Q}` }, then: null, secondary: [] };
const fig = (key, label, value, extra = {}) => ({ key, label, value, of: null, population: `${label.toLowerCase()} population`, window: 'everything recorded to date', detail: value == null ? null : `${label} detail`, reason: value == null ? `No ${label.toLowerCase()} yet.` : null, ...extra });
const EVIDENCE = { state: 'ok', figures: [
  fig('distinct_sources', 'Distinct sources', 4), fig('supporting', 'Supporting', 6), fig('contradicting', 'Contradictory', 0),
  fig('unknown_fit', 'Unknown fit', null), fig('experiment_results', 'Experiment results', 1, { of: 2 }), fig('demand_signals', 'Demand signals', 2),
] };
const ATTENTION = { state: 'ok', total: 6, items: [
  { kind: 'reviews', state: 'needs_review', label: '2 interviews awaiting review', detail: 'Wren Okafor has 3 proposed findings', action: 'Review interviews', href: `/validate/customer-research${Q}` },
  { kind: 'results', state: 'result_needed', label: '“Pricing page” has no result', detail: 'Marked done with nothing observed recorded.', action: 'Record the result', href: `/validate/experiments/12${Q}` },
  { kind: 'mixed', state: 'needs_review', label: 'H2 has mixed evidence', detail: 'H2: 1 supports and 1 contradicts it.', action: 'Review evidence', href: `/validate/experiments/12${Q}` },
  { kind: 'fit', state: 'not_recorded', label: '1 held interview has unknown customer fit', detail: 'Not placed in a segment yet.', action: 'Set fit', href: `/validate/customer-research${Q}&filter=fit:not_recorded` },
] };
const HYPOTHESES = { state: 'ok', total: 3, items: [
  { id: 11, code: 'H1', claim: 'Dock leads lose five hours a week', status: 'testing', supporting: 5, contradicting: 1, sources_label: '3 interviews behind 6 relationships', experiment: { title: 'Concierge test', status: 'done', result_recorded: true, result_needed: false }, href: `/validate/experiments/11${Q}` },
  { id: 12, code: 'H2', claim: 'They will pay a monthly fee', status: 'contested', supporting: 1, contradicting: 1, sources_label: '2 interviews behind 2 relationships', experiment: { title: 'Pricing page', status: 'done', result_recorded: false, result_needed: true }, href: `/validate/experiments/12${Q}` },
  { id: 13, code: 'H3', claim: 'Finance signs off', status: 'untested', supporting: 0, contradicting: 0, sources_label: '0 interviews behind 0 relationships', experiment: null, href: `/validate/experiments/13${Q}` },
] };
const CHANGES = { state: 'ok', items: [{ at: '2026-11-06 10:00:00', module: 'customer-research', module_name: 'Customer research', action: 'update', summary: 'Session transcribed' }] };
const CARDS = [{ slug: 'problem-discovery', name: 'Problem discovery', state: 'ok' }, { slug: 'customer-research', name: 'Customer research', state: 'ok' }];
const read = (extra = {}) => ({ cycle: 'validate', focus: FOCUS, meter: null, index: [], cards: CARDS, can_write: true,
  objective: { state: 'ok', text: 'Do dock leads lose enough time to pay?' }, evidence: EVIDENCE, attention: ATTENTION, hypotheses: HYPOTHESES, changes: CHANGES, ...extra });

const draw = (props) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [`/validate${Q}`] },
  h(ValidateOverview, { status: 'ready', search: Q, projectId: null, action: { label: 'Record a session', href: `/validate/record${Q}` }, onRetry: () => {}, ...props, raw: props.raw === undefined ? read() : props.raw, data: { cards: CARDS } })));
const count = (html, needle) => html.split(needle).length - 1;

test('1: the model reads each part as sent, Not recorded never 0, and nothing invented', () => {
  assert.deepEqual(partState(undefined), { state: 'absent' });
  assert.deepEqual(partState({ state: 'unavailable', reason: 'The hypotheses could not be read.' }), { state: 'unavailable', reason: 'The hypotheses could not be read.' });
  const ev = evidenceView(read());
  assert.equal(ev.figures.find((f) => f.key === 'unknown_fit').value, null, 'an empty population is Not recorded');
  assert.equal(ev.figures.find((f) => f.key === 'contradicting').value, '0', 'a counted zero stays 0');
  assert.equal(ev.figures.find((f) => f.key === 'experiment_results').value, '1 of 2');
  assert.equal(attentionView(read()).line, '4 of 6 · most useful first');
  assert.equal(attentionView(read({ attention: { state: 'ok', total: 1, items: ATTENTION.items.slice(0, 1) } })).line, '1 item · most useful first');
  assert.deepEqual(hypothesesView(read(), { writer: true }).rows.map((r) => [r.status, r.action]),
    [['Testing', 'Review evidence'], ['Mixed', 'Record the result'], ['Not started', 'Link evidence']]);
  assert.deepEqual(hypothesesView(read(), { writer: false }).rows.map((r) => r.action), ['Open', 'Open', 'Open'], 'a reader is never sent to a write');
  assert.equal(hypothesesView(read()).rows[2].experiment.text, 'No experiment yet');
  assert.equal(shortDay('2026-11-06 10:00:00'), '6 Nov');
  assert.equal(shortDay('soon'), null);
  assert.equal(changesView(read()).rows[0].text, 'Session transcribed');
  assert.equal(stillToEstablish(read()), null, 'a venture with records is not empty');
  assert.deepEqual(stillToEstablish({ cards: [{ slug: 'customer-research', name: 'Customer research', state: 'empty', reason: 'No interviews yet.' }, { slug: 'verdict', name: 'Verdict', state: 'ok' }] }).map((r) => r.name), ['Customer research']);
  assert.equal(stillToEstablish({ cards: [{ slug: 'a', name: 'A', state: 'empty' }, { slug: 'b', name: 'B', state: 'unavailable' }] }), null, 'a failed card is not "nothing yet"');
});

test('2: desktop V1 in order, one primary action, every figure with its population and window', () => {
  const html = draw({});
  const order = ['validate-objective', 'validate-next-action', 'validate-evidence', 'validate-attention', 'validate-changes', 'validate-hypotheses']
    .map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(order.every((i) => i >= 0), 'every V1 section is drawn');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'objective → next → evidence → attention → changes → hypotheses');
  assert.equal(count(html, 'data-testid="validate-next-cta"'), 1, 'exactly one next action');
  assert.ok(!/data-testid="cycle-action"[^>]*bg-axal-violet|bg-axal-violet[^"]*"[^>]*data-testid="cycle-action"/.test(html), 'Record a session is not a second primary');
  assert.ok(html.includes('Record a session'), 'Record a session stays in reach');
  assert.equal(count(html, 'data-testid="validate-evidence-population"'), 6, 'every figure names what it counts');
  assert.ok(html.includes('Counts distinct sources population · everything recorded to date'));
  assert.ok(html.includes('No unknown fit yet.'), 'a Not recorded figure says why');
  assert.ok(html.includes('4 of 6 · most useful first'));
  assert.ok(html.includes('Supports · 5') && html.includes('Contradicts · 1') && html.includes('No evidence linked'));
  assert.ok(html.includes('Result needed'));
  assert.ok(html.includes('6 Nov') && html.includes('Customer research') && html.includes('Session transcribed'));
  assert.equal(validateDef.Overview != null, true, 'the def mounts its own Overview');
});

test('3: V13 states — one part failing leaves the rest; loading, refused, unreadable, empty, reader and read-only', () => {
  const failed = draw({ raw: read({ evidence: { state: 'unavailable', reason: 'The evidence could not be read.' } }) });
  assert.ok(failed.includes('data-testid="validate-evidence-unavailable"') && failed.includes('Retry'));
  assert.ok(failed.includes('data-testid="validate-attention"') && failed.includes('data-testid="validate-hypotheses"'), 'the other parts still draw');
  for (const k of ['attention', 'hypotheses', 'changes']) {
    const one = draw({ raw: read({ [k]: { state: 'unavailable', reason: 'x' } }) });
    assert.ok(one.includes(`data-testid="validate-${k}-unavailable"`), `${k} fails on its own`);
    assert.ok(one.includes('data-testid="validate-evidence"') && one.includes('data-testid="validate-next-action"'), `${k} failing leaves the evidence and the next action`);
  }
  const older = draw({ raw: read({ evidence: undefined, attention: undefined, hypotheses: undefined, changes: undefined }) });
  assert.ok(!older.includes('data-testid="validate-evidence"') && older.includes('data-testid="validate-next-action"'), 'an older read draws what it has');
  assert.ok(draw({ status: 'loading', raw: null }).includes('aria-label="Loading Validate overview"'));
  assert.ok(draw({ status: 'refused', raw: null, message: 'This venture is not yours to open.' }).includes('This venture is not yours to open.'));
  assert.ok(draw({ status: 'unreadable', raw: null }).includes('data-testid="validate-overview-unreadable"'));
  const empty = draw({ raw: read({ cards: [{ slug: 'customer-research', name: 'Customer research', state: 'empty', reason: 'No interviews yet.', next: { text: 'Record a session', href: `/validate/record${Q}` } }, { slug: 'experiments', name: 'Experiments and evidence', state: 'empty', reason: 'No hypotheses written.' }] }) });
  assert.ok(empty.includes('data-testid="validate-still-to-establish"') && empty.includes('No interviews yet.') && empty.includes('No hypotheses written.'));
  assert.ok(!empty.includes('data-testid="validate-evidence"') && !empty.includes('data-testid="validate-hypotheses"'), 'not a wall of empty sections');
  const reader = draw({ raw: read({ can_write: false }) });
  assert.ok(reader.includes('data-testid="validate-read-only"') && reader.includes('Locked'));
  const readerHyps = reader.slice(reader.indexOf('data-testid="validate-hypotheses"'));
  assert.ok(!readerHyps.includes('>Record the result<') && !readerHyps.includes('>Link evidence<') && readerHyps.includes('>Open<'), 'a reader is sent to open a hypothesis, not to write');
  const support = draw({ readOnly: true });
  assert.ok(!support.includes('data-testid="cycle-action"') && support.includes('data-testid="validate-read-only"'), 'a read-only page has no Record a session');
});

test('4: V2 phone and 768 — the phone root with the objective first, three attention items, evidence from 768px, two hypothesis cards', () => {
  const html = draw({ phone: true });
  assert.ok(html.includes('data-testid="phone-root"'));
  const objectiveAt = html.indexOf('data-testid="validate-objective"');
  assert.ok(objectiveAt >= 0 && objectiveAt < html.indexOf('data-testid="phone-focus"'), 'the objective sits above the next action');
  assert.ok(html.indexOf('data-testid="phone-focus"') < html.indexOf('data-testid="validate-phone-parts"'));
  assert.equal(count(html, 'data-testid="validate-attention-'), 3 + 1, 'three items, plus the line');
  assert.ok(/class="hidden md:block"><section[^>]*data-testid="validate-evidence"/.test(html), 'the evidence draws from 768px only');
  assert.equal(count(html, 'data-testid="validate-phone-hypothesis-'), 2);
  assert.ok(!html.includes('role="table"'), 'no tables on the phone');
  assert.ok(!html.includes('data-testid="cycle-header"'), 'one navigation per width: the phone root’s own');
});

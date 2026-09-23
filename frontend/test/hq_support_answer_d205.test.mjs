/**
 * D205 — HQ answers an escalation from Support.
 *
 * `PATCH /api/admin/escalations/:uid` (D112) and `api.escalationAnswer` existed
 * with no caller, so a branch's escalation could be read at HQ and nothing
 * else: it sat on the board until its SLA passed, and D143's sweep then emailed
 * HQ a link to a list with no control on it. HQ Home's note even said
 * "answering one records HQ's decision" and linked to Content, which has no
 * answer control either.
 *
 * What is pinned here, rendered wherever a component is pure:
 *  - the two outcomes HQ records, and never the branch's `withdrawn`;
 *  - a reason is required before anything is sent;
 *  - a failure with no status is "not known", never "nothing was changed";
 *  - the result is two facts, recorded and delivered, with no retry button;
 *  - HQ Home's answer link lands on a page that can answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  DECISION_OUTCOMES, decisionError, EscalationDecisionView, RecordedOutcome, RecordedList,
  recordOf, escalationCardProps, QueueCard, SUPPORT_UNAVAILABLE,
} from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = read('frontend/src/pages/hq/HqSupportPage.jsx');
const CODE = codeOnly(PAGE);
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));

const ITEM = {
  uid: 'esc_1', branch_code: 'fr', kind: 'seat_increase', subject: 'Four more seats',
  subject_ref: 'seats:founder', detail: 'Cohort 3 starts Monday and we are four short.',
  raised_by_name: 'M. Dupont', sla: 'past', age_hours: 96.2,
};
const noop = () => {};
const view = (over = {}) => render(EscalationDecisionView, {
  item: ITEM, outcome: '', reason: '', busy: false, error: null,
  onChoose: noop, onReason: noop, onSubmit: noop, onCancel: noop, onReload: noop, ...over,
});
/** The submit button's own opening tag, so `disabled` is read off it and nothing else. */
const submitTag = (html) => {
  const at = html.indexOf('type="submit"');
  assert.ok(at > 0, 'the form has no submit button');
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1);
};

// ─────────────────────────────────────────────────────────── the outcomes ──

test('HQ records one of two outcomes, and never the branch’s own `withdrawn`', () => {
  assert.deepEqual(DECISION_OUTCOMES.map(([o]) => o), ['answered', 'declined']);
  // Withdrawing is the branch taking back its own request; `open` is refused by
  // the server. Neither may be offered as a thing HQ decides.
  assert.doesNotMatch(CODE, /'withdrawn'|"withdrawn"/, 'the page offers `withdrawn`, which is the branch’s act');
  const html = view();
  assert.match(html, />Record as answered</);
  assert.match(html, />Record as declined</);
  assert.doesNotMatch(renderedText(html), /withdraw/i);
});

// ──────────────────────────────────────────────────────── the choose phase ──

test('the choice shows what the branch sent, and no form yet', () => {
  const html = view();
  const t = renderedText(html);
  assert.match(t, /seat increase · raised by M\. Dupont · 96h old · past SLA/);
  assert.match(t, /About seats:founder/);
  assert.match(t, /Cohort 3 starts Monday and we are four short\./);
  assert.ok(html.includes('data-testid="hq-support-decision-actions"'));
  assert.ok(!html.includes('data-testid="hq-support-decision-form"'), 'the form renders before an outcome is chosen');
});

test('an escalation raised with no detail says so, rather than showing nothing', () => {
  const t = renderedText(view({ item: { ...ITEM, detail: null } }));
  assert.match(t, /No detail/);
});

// ─────────────────────────────────────────────────────────── the form phase ──

test('nothing is sent without a reason: the submit waits for one, spaces included', () => {
  assert.match(submitTag(view({ outcome: 'answered', reason: '' })), /disabled=""/, 'an empty reason can be sent');
  assert.match(submitTag(view({ outcome: 'answered', reason: '   ' })), /disabled=""/, 'a reason of spaces can be sent');
  assert.doesNotMatch(submitTag(view({ outcome: 'answered', reason: 'Granted for Q4.' })), /disabled=""/,
    'a real reason cannot be sent');
  assert.match(submitTag(view({ outcome: 'answered', reason: 'Granted for Q4.', busy: true })), /disabled=""/,
    'a second send can start while the first is in flight');
  const html = view({ outcome: 'answered', reason: 'x' });
  assert.match(html, /<textarea[^>]*maxLength="4000"/, 'the reason is not capped where the server caps it');
});

test('each outcome says what the branch will see, before it is sent', () => {
  const answered = renderedText(view({ outcome: 'answered', reason: 'x' }));
  assert.match(answered, /records HQ’s answer with your reason and sends it to fr/);
  assert.match(answered, /Recording it again later replaces it\./);
  assert.match(answered, /Record the answer/);

  // D112's collapse, said out loud: the branch's copy has no declined state.
  const declined = renderedText(view({ outcome: 'declined', reason: 'x' }));
  assert.match(declined, /records a refusal with your reason and sends it to fr/);
  assert.match(declined, /no separate declined state/);
  assert.match(declined, /HQ’s decision, with your reason as its words/);
  assert.match(declined, /Record the refusal/);
});

test('a refusal renders in words, and a reload is offered only where it is the next step', () => {
  const withReload = view({ outcome: 'answered', reason: 'x', error: { text: 'Not known.', reload: true } });
  assert.match(withReload, /role="alert"/);
  assert.match(renderedText(withReload), /Not known\.Reload the queue/);
  const without = view({ outcome: 'answered', reason: 'x', error: { text: 'Refused.', reload: false } });
  assert.match(renderedText(without), /Refused\./);
  assert.doesNotMatch(without, /Reload the queue/);
});

// ──────────────────────────────────────────────────────── the error rule ──

test('a failure with no status, or a 5xx, is "not known" — never "nothing was changed"', () => {
  // The shape `timeoutError` builds in api.js: no status, and a message whose
  // last sentence is false for a write that may already have committed.
  const timeout = Object.assign(new Error('The server did not respond within 30s. Nothing was changed.'),
    { name: 'TimeoutError', code: 'timeout', data: null });
  for (const err of [timeout, new TypeError('Failed to fetch'), Object.assign(new Error('Bad gateway'), { status: 502 })]) {
    const d = decisionError(err);
    assert.match(d.text, /not known/, `${err.message} read as a refusal`);
    assert.doesNotMatch(d.text, /Nothing was changed/);
    assert.match(d.text, /second answer replaces the first/);
    assert.equal(d.reload, true);
  }
});

test('a 404 has its own sentence, and a refusal reads its sentence rather than its code', () => {
  const gone = decisionError(Object.assign(new Error('not_found'), { status: 404, data: { error: 'not_found' } }));
  assert.match(gone.text, /no longer on HQ’s board/);
  assert.equal(gone.reload, true);

  // request() puts a string `error` code into `message`; the sentence is on `data`.
  const refused = decisionError(Object.assign(new Error('answer_required'), {
    status: 400, data: { error: 'answer_required', message: 'A decision needs its reason.' },
  }));
  assert.equal(refused.text, 'A decision needs its reason.');
  assert.equal(refused.reload, false);

  const denied = decisionError(Object.assign(new Error('Super admin required'), { status: 403, data: { detail: 'Super admin required' } }));
  assert.equal(denied.text, 'Super admin required');
});

// ───────────────────────────────────────────────────────── the call itself ──

test('the write sends the trimmed reason and the chosen outcome, and nothing else', () => {
  // Literal text, counted: a regex stopping at the first `)` would stop inside
  // `reason.trim()` and compare half the call.
  assert.equal(CODE.split('api.escalationAnswer(').length - 1, 1, 'the page answers from more than one place');
  assert.ok(CODE.includes('api.escalationAnswer(item.uid, { answer: reason.trim(), status: outcome })'),
    'the write does not send the trimmed reason and the chosen outcome');
  const at = CODE.indexOf('export function EscalationDecision(');
  assert.ok(at > 0);
  const body = CODE.slice(at, CODE.indexOf('\nexport ', at + 10));
  const tryPart = body.slice(body.indexOf('try {'), body.indexOf('} catch (err) {'));
  const catchPart = body.slice(body.indexOf('} catch (err) {'), body.indexOf('} finally {'));
  assert.ok(tryPart.includes('api.escalationAnswer(') && tryPart.includes('onRecorded?.('),
    'the outcome is reported somewhere other than after the write succeeded');
  assert.ok(catchPart.includes('setError(decisionError(err))'), 'a failed write does not render its error');
  assert.ok(!catchPart.includes('onRecorded'), 'a failed write is reported as recorded');
});

// ──────────────────────────────────────────────────────── the two facts ──

const REC = {
  uid: 'esc_1', branch_code: 'fr', subject: 'Four more seats', status: 'answered',
  answered_at: '2026-09-23T10:15:00.000Z',
};

test('a decision that did not reach the branch is recorded, not sent, and offers no retry', () => {
  const html = render(RecordedOutcome, { rec: { ...REC, pushed: {
    ok: false, reason: 'No branch Worker is bound for fr, so the decision is recorded at HQ and was not sent.',
  } } });
  const t = renderedText(html);
  assert.match(t, /Recorded at HQ at 10:15 UTC as answered\./);
  assert.match(t, /Not on fr: No branch Worker is bound for fr/);
  assert.match(t, /Nothing sends it again on its own; recording it again\s+replaces the decision and sends the new one\./);
  // No "yet": nothing will deliver it later on its own (#341).
  assert.doesNotMatch(t, /\byet\b/);
  // Recording again REPLACES the decision; a button that said "retry" would
  // promise a resend that does not exist.
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(t, /try again|retry|resend/i);
});

test('a delivered decision says the branch received it; an unreported one says so', () => {
  const got = renderedText(render(RecordedOutcome, { rec: { ...REC, pushed: { ok: true } } }));
  assert.match(got, /Recorded at HQ at 10:15 UTC as answered\./);
  assert.match(got, /fr received it\./);

  // No `pushed`, and a `pushed` with no boolean `ok`, are both "not reported" —
  // neither is a delivery that failed, and neither is one that landed.
  for (const pushed of [undefined, {}, { ok: 'yes' }]) {
    const unreported = renderedText(render(RecordedOutcome, { rec: { ...REC, pushed } }));
    assert.match(unreported, /Whether it reached fr was not reported\./, `pushed ${JSON.stringify(pushed)} read as reported`);
    assert.doesNotMatch(unreported, /received it|Not on fr/);
  }

  // A stamp that is not ISO is not sliced into a time: long enough that a
  // slice would print something, which is what makes this able to fail.
  const declined = renderedText(render(RecordedOutcome, { rec: { ...REC, status: 'declined', answered_at: 'not a timestamp at all', pushed: { ok: true } } }));
  assert.match(declined, /Recorded at HQ as declined\./, 'a time it could not read was printed anyway');
});

test('the session record takes the server’s answer over the item it answered', () => {
  const r = recordOf(ITEM, 'declined', { branch_code: 'fr', subject: 'Four more seats', status: 'declined', answered_at: REC.answered_at, pushed: { ok: true } });
  assert.deepEqual(r, { uid: 'esc_1', branch_code: 'fr', subject: 'Four more seats', status: 'declined', answered_at: REC.answered_at, pushed: { ok: true } });
  const bare = recordOf(ITEM, 'answered', null);
  assert.equal(bare.status, 'answered');
  assert.equal(bare.answered_at, null);
  assert.equal(bare.pushed, undefined);
});

test('the session list says it is only for this session, and why', () => {
  assert.equal(render(RecordedList, { recorded: [] }), '', 'an empty session draws an empty card');
  const t = renderedText(render(RecordedList, { recorded: [{ ...REC, pushed: { ok: true } }] }));
  assert.match(t, /Recorded this session/);
  assert.match(t, /Shown until you leave this page/);
  assert.match(t, /whether it reached the branch is not\s+stored against it/);
});

// ───────────────────────────────────────────────────────── the queue rows ──

const payload = {
  escalations: {
    available: true, complete: true, count: 2, bands: { ok: 1, due_soon: 0, past: 1 },
    items: [ITEM, { ...ITEM, uid: 'esc_2', subject: 'A second one', sla: 'ok', age_hours: 2 }],
  },
};

test('a row opens its own panel, under itself and outside its button', () => {
  const decide = { openUid: 'esc_2', onToggle: noop, panelFor: (x) => createElement('div', { 'data-testid': 'panel-for', 'data-uid': x.uid }) };
  const props = escalationCardProps(payload, false, decide);
  assert.deepEqual(props.items.map((i) => i.expanded), [false, true]);
  assert.equal(props.items[0].panel, null, 'a closed row carries a panel');

  const html = render(QueueCard, props);
  assert.equal((html.match(/<button type="button" aria-expanded="/g) || []).length, 2);
  assert.match(html, /aria-expanded="true"/);
  const panel = html.indexOf('data-testid="panel-for"');
  assert.ok(panel > 0, 'the open row’s panel is not drawn');
  assert.match(html, /data-uid="esc_2"/);
  // The panel follows the second row's button rather than sitting inside it —
  // a form inside a button is not a form anyone can type into.
  const secondButton = html.indexOf('<button', html.indexOf('<button') + 1);
  assert.ok(html.indexOf('</button>', secondButton) < panel, 'the panel is drawn inside the row’s button');
});

test('without `decide` the rows stay plain text, as the queue draws on its own', () => {
  const props = escalationCardProps(payload, false);
  assert.ok(props.items.every((i) => !('onToggle' in i)));
  assert.doesNotMatch(render(QueueCard, props), /<button/);
});

// ──────────────────────────────────────────────────────────────── the page ──

test('the page wires the panel, keeps the session list, and reloads quietly after a decision', () => {
  assert.ok(CODE.includes('escalationCardProps(ready, failed, decide)'), 'the escalation card is drawn without its panels');
  assert.ok(CODE.includes('<RecordedList recorded={recorded} />'), 'the session list is not drawn');
  const at = CODE.indexOf('const onRecorded = useCallback(');
  assert.ok(at > 0);
  const fn = CODE.slice(at, CODE.indexOf('}, [fetchSupport]);', at));
  assert.ok(fn.includes('setOpenUid(null)'), 'the panel stays open after its decision is recorded');
  assert.ok(fn.includes('fetchSupport(false)'), 'the refresh after a decision blanks the page');
  assert.ok(!fn.includes('load()'), 'the refresh after a decision blanks the page');
  assert.ok(CODE.includes('if (clear) setData(null);'));
});

test('the rail says the page acts, once, and the old refusal is gone', () => {
  assert.ok(!SUPPORT_UNAVAILABLE.some(([t]) => /Answering an escalation/.test(t)), 'the rail still says no screen answers');
  assert.doesNotMatch(CODE, /nothing calls it/);
  assert.ok(CODE.includes('stance="Read-only, except answering an escalation"'));
  assert.match(CODE, /The one action here records HQ's answer to an escalation, with its reason, and sends it to the branch\./);
  assert.ok(SUPPORT_UNAVAILABLE.some(([t, d]) => /arrived/.test(t) && /nothing sends a stored decision again/.test(d)),
    'the rail does not say that delivery is shown once and never re-sent');
});

// ─────────────────────────────────────────────────── HQ Home's answer link ──

test('HQ Home’s answer link lands on a page that can actually answer', () => {
  const home = read('frontend/src/pages/hq/HqHomePage.jsx');
  const app = read('frontend/src/App.jsx');
  const at = home.indexOf('data-testid="hq-escalations-answer-link"');
  assert.ok(at > 0);
  const link = home.slice(home.lastIndexOf('<Link', at), home.indexOf('</Link>', at));
  const to = /to="([^"]+)"/.exec(link)?.[1];
  assert.equal(to, '/admin/hq-support');
  assert.match(link, /Answer on Support/);

  // Follow the route to the file it renders. A registered route is not enough:
  // /admin/content was registered too, and could not answer anything.
  const route = app.indexOf(`path="${to}"`);
  assert.ok(route > 0, `${to} is not a registered route`);
  const element = app.slice(route, app.indexOf('/>', app.indexOf('<', app.indexOf('element={', route) + 9)));
  const name = /<([A-Z]\w*)/.exec(element.slice(element.indexOf('element={')))?.[1];
  assert.ok(name, 'the route renders no component');
  const lazyAt = app.indexOf(`const ${name} = lazy(() => import('`);
  assert.ok(lazyAt > 0, `${name} is not lazily imported by App.jsx`);
  const from = lazyAt + `const ${name} = lazy(() => import('`.length;
  const rel = app.slice(from, app.indexOf("'", from));
  const file = [`${rel}.jsx`, rel].map((r) => resolve(root, 'frontend/src', r)).find((f) => existsSync(f));
  assert.ok(file, `${rel} does not resolve to a file`);
  assert.ok(readFileSync(file, 'utf8').includes('api.escalationAnswer('),
    `${to} renders ${rel}, which cannot answer an escalation`);
});

/**
 * D5039 (#5039 part 2; canvas RV05, RV05b, RV14c) — the statement drawer's
 * governed actions: Record a payment, Mark issued and Void.
 *
 * Held here: what each statement offers and why not; the before → after a
 * payment would make, in the statement's own currency and never with an
 * unknown figure as 0; the body each action sends (reason, revision, key);
 * the six outcomes kept apart, unknown never drawn as success; the
 * double-submit guard and the replay with the same key; the flow's steps and
 * its accessible structure; and the source rules (no window.confirm, the
 * drawer guarding Escape while a request is out).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { revenuePart } from './_revenuePage.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  ACTION_REASON_MIN, FLOW_STEPS, actionAvailability, actionBody, classifyOutcome, createActionRunner,
  newIdempotencyKey, paymentPreview, pendingStep, receiptRows, revisionOf, statusPreview, adjustmentPreview,
} from '../src/pages/hq/revenue/statementActionModel.js';
import { FlowOutcome, StatementActionFlow } from '../src/pages/hq/revenue/StatementActionFlow.jsx';
import { StatementActions } from '../src/pages/hq/RevenuePage.jsx';

const plain = (s) => String(s).replace(/[  ]/g, ' ');
const st = (extra = {}) => ({
  uid: 'st_fr', licence_uid: 'lic_fr', brand_name: 'Axal VC France', period: '2026-Q3', currency: 'EUR',
  status: 'issued', owed_cents: 1_140_000, paid_cents: 760_000, disputed_cents: 0, outstanding_cents: 380_000,
  unreported_streams: 0, estimated_streams: 0, complete: true, revision: 4, ...extra,
});
const REASON = 'Received by SEPA, matched to the Q3 statement';

test('what each status offers, and the reason beside what it does not', () => {
  const draft = actionAvailability(st({ status: 'draft', paid_cents: 0 }));
  assert.deepEqual([draft.issue.offered, draft.record_payment.offered, draft.void.offered], [true, false, true]);
  assert.match(draft.record_payment.why, /Mark it issued first/);
  const floor = actionAvailability(st({ status: 'draft', paid_cents: 0, unreported_streams: 2, complete: false }));
  assert.equal(floor.issue.offered, false);
  assert.match(floor.issue.why, /floor/);
  const issued = actionAvailability(st());
  assert.deepEqual([issued.issue.offered, issued.record_payment.offered, issued.void.offered], [false, true, false]);
  assert.match(issued.void.why, /payment is recorded/);
  for (const status of ['paid', 'void']) {
    const a = actionAvailability(st({ status }));
    assert.deepEqual([a.issue.offered, a.record_payment.offered, a.void.offered], [false, false, false], status);
  }
  // An unreadable paid figure is not read as "nothing paid".
  const unread = actionAvailability(st({ status: 'draft', paid_cents: null }));
  assert.equal(unread.void.offered, false);
  assert.match(unread.void.why, /could not be read/);
});

test('Record a payment: before → after in the statement currency, adding to what was paid (RV05b)', () => {
  const p = paymentPreview({ statement: st(), amountText: '3800', reference: 'SEPA-FR-2290', reason: REASON });
  assert.equal(p.amount, 380_000);
  assert.equal(p.settles, true);
  assert.deepEqual(p.body, { amount_cents: 380_000, reference: 'SEPA-FR-2290', reason: REASON });
  const rows = Object.fromEntries(p.rows.map((r) => [r.label, [plain(r.before), plain(r.after)]]));
  assert.deepEqual(rows.Outstanding, ['€3,800.00', '€0.00']);
  assert.deepEqual(rows['Paid · recorded by HQ'], ['€7,600.00', '€11,400.00']);
  assert.deepEqual(rows.Status, ['Issued', 'Paid']);
  const part = paymentPreview({ statement: st(), amountText: '1000', reason: REASON });
  assert.equal(part.settles, false);
  assert.equal(part.rows.find((r) => r.label === 'Status').after, 'Issued · part paid');
  assert.equal(plain(paymentPreview({ statement: st({ currency: 'JPY', owed_cents: 5000, paid_cents: 0 }), amountText: '1234', reason: REASON }).amountLabel), '¥1,234');
});

test('Record a payment refuses before the call what the Worker would refuse, and never reads unknown as 0', () => {
  const err = (o) => paymentPreview({ statement: st(), amountText: '100', reason: REASON, ...o }).error;
  assert.match(err({ amountText: '' }), /Enter the amount/);
  assert.match(err({ amountText: '0' }), /more than nothing/);
  assert.match(err({ amountText: '10.005' }), /2 decimal places/);
  assert.match(plain(err({ amountText: '3800.01' })), /more than the €3,800\.00 still open/);
  assert.match(err({ reason: 'paid' }), new RegExp(`at least ${ACTION_REASON_MIN} characters`));
  assert.match(err({ reference: 'x'.repeat(121) }), /at most 120/);
  for (const k of ['owed_cents', 'paid_cents', 'disputed_cents']) {
    const e = paymentPreview({ statement: st({ [k]: null }), amountText: '100', reason: REASON }).error;
    assert.match(e, /could not be read/, `${k} unreadable`);
  }
  assert.match(paymentPreview({ statement: st({ currency: '' }), amountText: '1', reason: REASON }).error, /no currency/);
  // A floor is never settled as a total; a part payment against it is fine.
  const floor = st({ unreported_streams: 1, complete: false });
  assert.match(paymentPreview({ statement: floor, amountText: '3800', reason: REASON }).error, /floor/);
  // Mark issued and Void's rows: an unreadable figure reads Not recorded.
  const rows = statusPreview('void', st({ owed_cents: null }));
  assert.ok(rows.every((r) => !/€0/.test(plain(r.before))));
  assert.equal(rows.find((r) => r.label === 'Owed to HQ').before, 'Not recorded');
});

test('every action sends its reason, the revision it read and its own key', () => {
  const key = newIdempotencyKey('record_payment');
  assert.match(key, /^[A-Za-z0-9_.:-]{8,200}$/, 'the Worker\'s IDEMPOTENCY_KEY_RE');
  assert.notEqual(key, newIdempotencyKey('record_payment'));
  assert.deepEqual(
    actionBody({ kind: 'record_payment', statement: st(), fields: { amount_cents: 5, reference: null }, reason: ` ${REASON} `, key }),
    { amount_cents: 5, reference: null, reason: REASON, expected_revision: 4, idempotency_key: key },
  );
  assert.deepEqual(Object.keys(actionBody({ kind: 'void', statement: st(), fields: { amount_cents: 5 }, reason: REASON, key })).sort(),
    ['expected_revision', 'idempotency_key', 'reason'], 'a void carries no amount');
  assert.equal(revisionOf({}), 0);
  assert.equal(revisionOf({ revision: 7 }), 7);
});

test('six outcomes, never folded: settled, partial, applied, refused, stale and unknown', () => {
  const applied = (extra) => ({ outcome: 'applied', replayed: false, ...extra });
  assert.equal(classifyOutcome({ kind: 'record_payment', result: applied({ settled: true }) }).kind, 'settled');
  assert.equal(classifyOutcome({ kind: 'record_payment', result: applied({ settled: false }) }).kind, 'partial');
  assert.equal(classifyOutcome({ kind: 'void', result: applied() }).kind, 'applied');
  assert.equal(classifyOutcome({ kind: 'issue', result: applied({ replayed: true }) }).replayed, true);
  const e = (status, data, code) => Object.assign(new Error(data?.message || 'x'), { status, data, code });
  assert.equal(classifyOutcome({ kind: 'void', error: e(409, { error: 'invalid_status', message: 'This statement is paid' }, 'invalid_status') }).kind, 'refused');
  const stale = classifyOutcome({ kind: 'issue', error: e(409, { error: 'changed_since_open', current: { revision: 5 } }, 'changed_since_open') });
  assert.equal(stale.kind, 'stale');
  assert.deepEqual(stale.current, { revision: 5 });
  assert.match(classifyOutcome({ kind: 'void', error: e(403, {}, 'step_up_required') }).message, /authenticator code was not entered/);
  for (const err of [new Error('Network error'), e(500, {}), e(502, {}), Object.assign(new Error('t'), { code: 'timeout' })]) {
    const o = classifyOutcome({ kind: 'record_payment', error: err });
    assert.equal(o.kind, 'unknown', String(err.status));
    assert.doesNotMatch(o.title, /recorded|success|paid/i);
  }
  // A 200 that does not say "applied" is not taken for success either.
  assert.equal(classifyOutcome({ kind: 'record_payment', result: {} }).kind, 'unknown');
});

test('a second send while one is out sends nothing; a retry resends the same key', async () => {
  const calls = [];
  let release;
  const runner = createActionRunner((kind, uid, body) => {
    calls.push(body.idempotency_key);
    return new Promise((ok) => { release = ok; });
  });
  const body = { reason: REASON, expected_revision: 4, idempotency_key: 'rv-pay-key-1' };
  const first = runner.run('record_payment', 'st_fr', body);
  assert.equal(runner.busy, true);
  assert.equal(await runner.run('record_payment', 'st_fr', body), null, 'a double click sent twice');
  release({ outcome: 'applied', settled: false });
  assert.equal((await first).kind, 'partial');
  assert.equal(runner.busy, false);

  let n = 0;
  const flaky = createActionRunner((kind, uid, b) => {
    calls.push(b.idempotency_key);
    n += 1;
    if (n === 1) return Promise.reject(new Error('Network error'));
    return Promise.resolve({ outcome: 'applied', settled: true, replayed: true });
  });
  assert.equal((await flaky.run('record_payment', 'st_fr', body)).kind, 'unknown');
  const again = await flaky.run('record_payment', 'st_fr', body);
  assert.deepEqual([again.kind, again.replayed], ['settled', true]);
  assert.deepEqual(calls, ['rv-pay-key-1', 'rv-pay-key-1', 'rv-pay-key-1']);
});

test('the flows: Prepare → Review → Confirm → Authenticate → Receipt, and Scope → Review → Authenticate → Result for a void', () => {
  assert.deepEqual([...FLOW_STEPS.record_payment], ['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']);
  assert.deepEqual([...FLOW_STEPS.issue], ['Prepare', 'Review', 'Confirm', 'Receipt']);
  assert.deepEqual([...FLOW_STEPS.void], ['Scope', 'Review', 'Authenticate', 'Result']);
  assert.deepEqual([pendingStep('record_payment'), pendingStep('void'), pendingStep('issue')], ['Authenticate', 'Authenticate', 'Confirm']);

  const h = renderToStaticMarkup(React.createElement(StatementActionFlow, {
    kind: 'record_payment', statement: st(), onSubmit: async () => ({}), onClose: () => {},
  }));
  const t = renderedText(h);
  assert.match(t, /Record a payment · Prepare/);
  assert.match(h, /aria-current="step"[^>]*>.*Prepare/);
  assert.match(h, /<h3 id="rv-flow-title"[^>]*tabindex="-1"/, 'the step heading takes focus');
  assert.match(h, /<label[^>]*for="rv-flow-amount"/);
  assert.match(h, /<label[^>]*for="rv-flow-reason"/);
  assert.match(t, /Amount received · EUR/);
  assert.match(h, /min-h-\[44px\]/, 'phone-sized controls (RV14c)');
  assert.match(h, /flex-col-reverse gap-2 sm:flex-row/, 'the buttons stack on a phone');

  const v = renderedText(renderToStaticMarkup(React.createElement(StatementActionFlow, {
    kind: 'void', statement: st({ status: 'draft', paid_cents: 0 }), onSubmit: async () => ({}), onClose: () => {},
  })));
  assert.match(v, /Void statement · Scope/);
  assert.match(v, /cannot be drawn again/);
});

test('the receipt draws only what the Worker returned; unknown offers Check again and no figures', () => {
  const result = {
    outcome: 'applied', settled: false, replayed: false,
    before: { status: 'issued', outstanding_cents: 380_000 }, after: { status: 'issued', outstanding_cents: 280_000 },
    receipt: { action_uid: 'act_1', at: '2026-11-09T10:15:00.000Z', reason: REASON, currency: 'EUR', amount_cents: 100_000, reference: 'SEPA-1' },
  };
  const rows = Object.fromEntries(receiptRows(result).map(([k, v]) => [k, plain(v)]));
  assert.equal(rows.Amount, '€1,000.00');
  assert.equal(rows.Outstanding, '€3,800.00 → €2,800.00');
  assert.equal(rows['Recorded at'], '2026-11-09 10:15 UTC');
  assert.equal(rows.Receipt, 'act_1');
  assert.equal(Object.fromEntries(receiptRows({ receipt: { currency: 'EUR' } })).Receipt, 'Not returned');

  const draw = (outcome) => renderToStaticMarkup(React.createElement(FlowOutcome, {
    outcome, kind: 'record_payment', busy: false, onRetry: () => {}, onBack: () => {}, onClose: () => {},
    actionsClass: '', primary: '', secondary: '',
  }));
  const partial = draw({ ...classifyOutcome({ kind: 'record_payment', result }), result });
  assert.match(partial, /data-outcome="partial"/);
  assert.match(renderedText(partial), /part still outstanding/);
  assert.match(partial, /role="status"/);

  const unknown = draw({ ...classifyOutcome({ kind: 'record_payment', error: new Error('Network error') }), result: null });
  const ut = renderedText(unknown);
  assert.match(unknown, /data-outcome="unknown"/);
  assert.match(unknown, /role="alert"/);
  assert.match(unknown, /<button[^>]*>Check again<\/button>/, 'an unknown outcome offers the same-key retry');
  assert.match(ut, /an unknown is not a zero/);
  assert.doesNotMatch(ut, /€|Payment recorded|Done/, 'an unknown outcome was drawn as a success or a figure');
  assert.doesNotMatch(unknown, /hq-statement-flow-receipt/);

  const refused = draw({ ...classifyOutcome({ kind: 'record_payment', error: Object.assign(new Error('x'), { status: 409, data: { message: 'over' } }) }), result: null });
  assert.match(refused, /data-outcome="refused"/);
  assert.match(renderedText(refused), /Refused · nothing was written/);
  assert.match(renderedText(refused), /Back to the form/);
});

test('the footer opens the flows; the drawer swaps in the flow and holds Escape while a request is out', () => {
  const h = renderedText(renderToStaticMarkup(React.createElement(StatementActions, { statement: st(), onUpdate: async () => ({}), onStart: () => {} })));
  assert.match(h, /Record payment…/);
  assert.match(h, /Record dispute…/);
  assert.match(h, /payments, voids, disputes and due dates require recent authentication/);
  const drawer = codeOnly(revenuePart('Receivables.jsx'));
  assert.match(drawer, /<StatementActionFlow\b/);
  assert.match(drawer, /onEscape=\{flow \? \(\) => \{ if \(!flowBusy\) setFlow\(null\); \} : undefined\}/);
  assert.match(drawer, /onClose=\{\(\) => \{ if \(!flowBusy\) onClose\(\); \}\}/);
  for (const f of ['StatementActionFlow.jsx', 'statementActionModel.js', 'StatementActions.jsx', 'Receivables.jsx', 'Promotions.jsx']) {
    const src = codeOnly(revenuePart(f));
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/, f);
    assert.doesNotMatch(src, /text-\[(8|9|10|11)(\.\d)?px\]/, `${f}: type under 12px`);
  }
});

test('dispute review uses native minor units and refuses missing or over-owed figures', () => {
  const preview = (extra = {}) => adjustmentPreview({ kind: 'record_dispute', statement: st(), amountText: '25.50', reason: REASON, ...extra });
  assert.deepEqual(preview().body, { disputed_cents: 2550 });
  assert.equal(preview().rows[1].after, '€3,774.50');
  assert.ok(preview({ amountText: '' }).error);
  assert.ok(preview({ amountText: '3800.01' }).error);
  assert.ok(preview({ statement: st({ owed_cents: null }) }).error);
  assert.ok(preview({ amountText: '0', reason: '' }).error);
  assert.deepEqual(preview({ amountText: '0' }).body, { disputed_cents: 0 });
  const jpy = preview({ statement: st({ currency: 'JPY' }), amountText: '25' });
  assert.equal(jpy.body.disputed_cents, 25);
});

test('due-date review preserves unknown dates, validates calendar days and shows explicit clearing', () => {
  const preview = (extra = {}) => adjustmentPreview({ kind: 'set_due_date', statement: st(), dueOn: '2026-12-01', reason: REASON, ...extra });
  assert.deepEqual(preview().body, { due_on: '2026-12-01' });
  assert.equal(preview().rows[0].before, 'Not recorded');
  assert.ok(preview({ dueOn: '2026-02-30' }).error);
  assert.ok(preview({ statement: st({ status: 'paid' }) }).error);
  const clear = preview({ dueOn: '', statement: st({ due_on: '2026-12-01' }) });
  assert.deepEqual(clear.body, { due_on: null });
  assert.match(clear.rows[0].after, /cleared/);
});

test('new adjustments retain review, confirmation, authentication and exact request fields', () => {
  for (const kind of ['record_dispute', 'set_due_date']) {
    assert.deepEqual(FLOW_STEPS[kind], ['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']);
    const fields = kind === 'record_dispute' ? { disputed_cents: 0 } : { due_on: null };
    assert.deepEqual(actionBody({ kind, statement: st(), fields, reason: REASON, key: 'test-key' }), {
      ...fields, reason: REASON, expected_revision: 4, idempotency_key: 'test-key',
    });
    assert.match(renderToStaticMarkup(React.createElement(StatementActionFlow, { kind, statement: st() })), kind === 'record_dispute' ? /Disputed amount/ : /Due date · UTC/);
    assert.equal(classifyOutcome({ kind, result: { outcome: 'applied' } }).title, kind === 'record_dispute' ? 'Dispute recorded' : 'Due date recorded');
  }
});

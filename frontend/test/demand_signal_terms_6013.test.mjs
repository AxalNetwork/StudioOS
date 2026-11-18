import test from 'node:test';
import assert from 'node:assert/strict';
import { VALIDATE_FORMS, VALIDATE_EDITS, initialValues, validate } from '../src/pages/cycles/forms.js';

const create = VALIDATE_FORMS['demand-signals'][0];
const edit = VALIDATE_EDITS['demand-signals'];

test('Would pay is offered and preserves currency and interval with exact minor units', () => {
  assert.ok(create.fields.find(field => field.name === 'kind').opts.some(choice => choice.value === 'would_pay'));
  for (const [currency, amount, minor] of [['eur', '12.34', 1234], ['jpy', '123', 123], ['kwd', '1.234', 1234]]) {
    const values = { ...initialValues(create), kind: 'would_pay', amount, currency, period: 'month' };
    assert.deepEqual(validate(create, values), {});
    const body = create.toBody(values);
    assert.deepEqual([body.kind, body.amount_cents, body.currency, body.period], ['would_pay', minor, currency, 'month']);
    const current = edit.valuesOf({ edit: body });
    assert.deepEqual([current.amount, current.currency, current.period], [amount, currency, 'month']);
    assert.equal(edit.toBody(current).amount_cents, minor);
  }
});

test('changing to a kind without an amount or clearing it clears the recorded terms', () => {
  for (const values of [
    { kind: 'waitlist', amount: '40', currency: 'eur', period: 'month' },
    { kind: 'loi', amount: '', currency: 'kwd', period: 'year' },
  ]) {
    const body = edit.toBody(values);
    assert.deepEqual([body.amount_cents, body.currency, body.period], [null, null, null]);
  }
  assert.ok(validate(create, { kind: 'pre_sale', amount: '1.001', currency: 'eur' }).amount);
});

test('editing old records retains missing and unrecorded terms without inventing a period', () => {
  const current = edit.valuesOf({ edit: { kind: 'pre_sale', amount_cents: 1234, currency: 'eur', period: null } });
  assert.deepEqual([current.amount, current.currency, current.period], ['12.34', 'eur', '']);
  assert.equal(edit.toBody(current).period, null);
  assert.deepEqual(edit.toBody({ who: 'New name' }), { who: 'New name' });
  assert.deepEqual(edit.toBody({ currency: 'eur', period: 'year' }), { currency: 'eur', period: 'year' });
});

test('an unlisted stored currency retains an explicit count of minor units', () => {
  const current = edit.valuesOf({ edit: { kind: 'loi', amount_cents: 4321, currency: 'zzz', period: 'year' } });
  assert.equal(current.amount, '4321 minor units');
  assert.deepEqual(validate(edit, current), {});
  assert.deepEqual([edit.toBody(current).amount_cents, edit.toBody(current).currency], [4321, 'zzz']);
});

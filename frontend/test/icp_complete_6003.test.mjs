/** D6003 (#6003): ICP forms round-trip Context and value evidence, including omitted-key edits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, EDITS } from '../src/pages/cycles/forms.js';
import { recordEditAction, recordFormFor } from '../src/pages/cycles/recordModel.js';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { h, mountForm } from './_form_d695.mjs';

const edit = EDITS.validate['ideal-customer-profile'];
const stored = { name: 'Operators', who_they_are: 'Logistics operators', context: 'When routing shifts', job_to_be_done: 'Dispatch', urgency: 'high', value_promised: 'Fewer missed jobs', value_source: 'Interviews 1–3', score_since: null };
const record = { id: 81, actions: [{ key: 'edit', kind: 'form', form: { fields: Object.entries(stored).map(([key, value]) => ({ key, value })) } }] };

test('the real Edit form exposes and keeps the two missing five-step fields', async () => {
  const spec = recordFormFor(recordEditAction(record), record, edit);
  assert.equal(spec.current.context, stored.context);
  assert.equal(spec.current.value_source, stored.value_source);
  const ui = await mountForm(h(FormLightbox, { form: spec.form, current: spec.current, cycle: 'validate', slug: 'ideal-customer-profile', onSubmit() {}, onClose() {} }));
  try {
    assert.ok(ui.by('cycle-form-context'));
    assert.ok(ui.by('cycle-form-value_source'));
  } finally { await ui.unmount(); }
  assert.equal(edit.toBody(spec.current).context, stored.context);
  assert.equal(edit.toBody(spec.current).value_source, stored.value_source);
  assert.deepEqual(edit.toBody({ name: 'Only rename' }), { name: 'Only rename' });
});


test('the Add form sends both evidence fields to the existing writer', () => {
  const form = FORMS.validate['ideal-customer-profile'][0];
  const body = form.toBody(stored);
  assert.equal(body.context, stored.context);
  assert.equal(body.value_source, stored.value_source);
});

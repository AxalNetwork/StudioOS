// D6788: the existing record renderer and Mark held form display and submit the board-resolution contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordView, { RecordPhoneProvider } from '../src/pages/cycles/RecordView.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { recordActionBody, recordFormFor } from '../src/pages/cycles/recordModel.js';
import { mountForm } from './_form_d695.mjs';

const h = React.createElement;
const action = { key: 'mark-held', label: 'Mark held', kind: 'form', multipart: true, form: { title: 'Mark held', cta: 'Mark held', fields: [
  { key: 'held_on', label: 'Held on', kind: 'T', input: 'date', required: true },
  { key: 'minutes', label: 'Minutes', kind: 'T', input: 'file' },
  { key: 'resolutions', label: 'Resolutions', kind: 'T', input: 'textarea', max: 40019, note: 'One resolution per line, up to 20.' },
  { key: 'resolutions_passed_on', label: 'Resolutions passed on', kind: 'T', input: 'date' },
  { key: 'cite_minutes', label: 'Cite uploaded minutes for these resolutions', kind: 'CH', value: 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
] } };
const record = { id: '51', title: 'Board meeting', facts: [], pills: [], activity: [], actions: [action], main: [{ key: 'resolutions', title: 'Resolutions', empty: 'None recorded', rows: [
  { a: 'Meeting held 2026-11-30', b: 'None recorded' },
  { a: 'Approve the budget', b: 'Held 2026-10-30 · Passed 2026-10-29 · Recorded by Synthetic Editor' },
] }], side: [] };

test('6788: desktop and phone show resolution text, held/passed dates, actor and None recorded in newest-first order', () => {
  for (const phone of [false, true]) {
    const markup = renderToStaticMarkup(h(RecordPhoneProvider, { phone }, h(RecordView, { record, cycleName: 'Grow', moduleName: 'Company', onForm() {} })));
    if (phone) assert.match(markup, /data-phone="true"/);
    assert.match(markup, /Resolutions/); assert.match(markup, /None recorded/); assert.match(markup, /Approve the budget/);
    assert.match(markup, /Passed 2026-10-29/); assert.match(markup, /Recorded by Synthetic Editor/);
    assert.ok(markup.indexOf('Meeting held 2026-11-30') < markup.indexOf('Approve the budget'));
    assert.doesNotMatch(markup, /No resolution store/);
  }
});

test('6788: Mark held uses the real textarea and preserves multiple resolutions, passed date, minutes and explicit citation in multipart', async () => {
  const form = recordFormFor(action, record);
  let sent;
  const ui = await mountForm(h(FormLightbox, { form: form.form, current: form.current, cycle: 'grow', slug: 'durable-company-building', onClose() {},
    onSubmit: async values => { sent = recordActionBody(action, values); return { ok: true }; } }));
  try {
    assert.equal(ui.by('cycle-form-resolutions').tagName, 'TEXTAREA');
    assert.equal(ui.props(ui.by('cycle-form-resolutions')).maxLength, 40019);
    await ui.input('held_on', '2026-11-30');
    await ui.input('resolutions', 'Approve hiring\nApprove budget');
    await ui.input('resolutions_passed_on', '2026-11-29');
    await ui.input('minutes', new File(['synthetic minutes'], 'minutes.pdf', { type: 'application/pdf' }));
    await ui.choose('cite_minutes', 'yes');
    await ui.submit();
    assert.ok(sent instanceof FormData);
    assert.equal(sent.get('resolutions'), 'Approve hiring\nApprove budget');
    assert.equal(sent.get('held_on'), '2026-11-30'); assert.equal(sent.get('resolutions_passed_on'), '2026-11-29');
    assert.equal(sent.get('cite_minutes'), 'yes'); assert.equal(sent.get('minutes').name, 'minutes.pdf');
    assert.equal(await sent.get('minutes').text(), 'synthetic minutes');
  } finally { await ui.unmount(); }
});

test('6788: a read-only record retains resolutions while exposing no Mark held action', () => {
  const markup = renderToStaticMarkup(h(RecordView, { record: { ...record, actions: [] }, cycleName: 'Grow', moduleName: 'Company' }));
  assert.match(markup, /Approve the budget/); assert.doesNotMatch(markup, /Mark held/);
});

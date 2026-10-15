/**
 * D695 independent UI: real fields/saves and opt-in page/dialog behavior.
 * Routing/registry integration remains gated by #1652, #1655 and #1660.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import FormLightbox, * as model from '../src/pages/cycles/FormLightbox.jsx';
import Lightbox from '../src/ui/Lightbox.jsx';
import { FORMS, EDITS, systemOptions } from '../src/pages/cycles/forms.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { scrollLocks } from '../src/ui/lightboxFocus.js';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

const path = 'pages/cycles/FormLightbox.jsx';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/ui/Lightbox.jsx', import.meta.url), 'utf8');
const fixture = () => ({
  title: 'New signal', sub: 'Record the venture’s own evidence.', cta: 'Record signal', foot: 'Keep the evidence attached.',
  fields: [
    { name: 'title', kind: 'T', k: 'Signal', ph: '[Describe the signal]', h: 56, required: true, max: 60 },
    { name: 'kind', kind: 'CH', k: 'Kind', opts: [{ value: 'waitlist', label: 'Waitlist sign-up' }, { value: 'pre-sale', label: 'Pre-sale' }], def: 'waitlist' },
    { name: 'amount', kind: 'T', k: 'Amount', input: 'money', ph: '€[100]', when: { name: 'kind', value: 'pre-sale' } },
    { name: 'evidence', kind: 'CK', k: 'Evidence', opts: [{ value: 'one', label: 'First quote', meta: 'unthemed', checked: true }, { value: 'two', label: 'Second quote', meta: 'in Harbour theme' }], note: (values) => values.evidence.length + ' of 5 needed before a verdict is given.' },
    { name: 'pair', kind: 'T', k: 'Owner · deadline', parts: [{ name: 'owner', kind: 'T', k: 'Owner' }, { name: 'due', kind: 'T', k: 'Deadline', input: 'date' }] },
    { name: 'proof', kind: 'T', k: 'Proof', input: 'file' },
  ],
});
const props = { cycle: 'validate', slug: 'demand-signals', onClose() {} };

function assertModel(m) {
  const base = fixture(); const fields = m.formFields(base); const values = m.formValues(fields);
  assert.equal(fields[0].label, 'Signal'); assert.equal(fields[0].input, 'text');
  assert.equal(values.kind, 'waitlist'); assert.deepEqual(values.evidence, ['one']);
  assert.equal(values.owner, ''); assert.equal(values.due, '');
  assert.equal(m.cleanFormCopy('€[100]'), '$100');
  assert.equal(m.fieldVisible(fields[2], values), false);
  assert.equal(m.fieldVisible(fields[2], { ...values, kind: 'pre-sale' }), true);
  assert.equal(m.fieldVisible({ when: (v) => v.yes }, { yes: false }), false);
  assert.equal(m.fieldVisible({ when: { name: 'evidence', value: 'one' } }, values), true);
  assert.ok(!Object.hasOwn(m.submittedValues(fields, { ...values, amount: '40' }), 'amount'));
  assert.equal(m.formErrors(base, fields, values).title, 'Signal is required.');
  assert.equal(m.formErrors(base, fields, { ...values, title: 'X'.repeat(61) }).title, 'Signal is at most 60 characters.');
  assert.equal(m.formErrors(base, fields, { ...values, title: 'Test', kind: 'invented' }).kind, 'Pick one of the choices for kind.');
  assert.equal(m.formErrors(base, fields, { ...values, title: 'Test', kind: 'pre-sale', amount: '-1' }).amount, 'Type an amount in US dollars, 0 or more.');
  assert.equal(m.formErrors(base, fields, { ...values, title: 'Test', due: 'bad' }).due, 'Pick a date.');
  assert.ok(m.formErrors(base, fields, { ...values, evidence: ['not-recorded'] }).evidence);
  const legacy = m.formFields({ fields: [{ name: 'choice', label: 'Choice', type: 'select', initial: 'two', options: [{ value: 'two', label: 'Two' }] }, { name: 'note', label: 'Note', type: 'textarea' }] });
  assert.equal(legacy[0].kind, 'CH'); assert.equal(legacy[1].input, 'textarea');
  assert.equal(m.formValues(legacy).choice, 'two');
  assert.equal(m.formValues(legacy, { choice: 'row-value' }, { choice: 'query-value' }).choice, 'row-value');
  assert.equal(m.formValues(legacy, null, { choice: 'query-value' }).choice, 'query-value');
}
test('field adapter preserves legacy rules, defaults, conditional payloads and canvas kinds', async () => {
  assertModel(model);
  await mutationCheck(source, path, assertModel, [
    ["field.type === 'select' ? 'CH'", "field.type === 'select' ? 'T'"],
    ["if (!field.when) return true;", 'if (true) return true;'],
    ["option.checked).map", "false).map"],
    ["formFields({ fields: field.parts }, loaded)", '[]'],
    ["return errors;\n}", 'return {};\n}'],
    [".replace(/€/g, '$')", ''],
  ]);
});

async function assertFields(m) {
  const saved = []; const f = fixture();
  const mount = await mountForm(h(m.default, { ...props, form: f, onSubmit: async (values) => saved.push(values) }));
  try {
    assert.ok(mount.text().includes('Validate · Demand and urgency signals'));
    assert.ok(mount.text().includes(f.sub)); assert.ok(mount.text().includes(f.foot));
    assert.equal(mount.props(mount.by('cycle-form')).role, 'dialog');
    assert.equal(mount.props(mount.by('cycle-form'))['aria-modal'], 'true');
    assert.ok(!mount.text().includes('required'));
    assert.equal(mount.by('cycle-form-title').tagName, 'TEXTAREA');
    assert.equal(mount.props(mount.by('cycle-form-title')).style.minHeight, 56);
    assert.equal(mount.props(mount.by('cycle-form-title')).placeholder, 'Describe the signal');
    assert.ok(!mount.by('cycle-form-amount'));
    assert.ok(mount.text().includes('1 of 5 needed before a verdict is given.'));
    assert.ok(mount.text().includes('unthemed'));
    assert.equal(mount.nodes().filter((n) => n.tagName === 'FIELDSET').length, 1);
    await mount.choose('evidence', 'two');
    assert.ok(mount.text().includes('2 of 5 needed before a verdict is given.'));
    await mount.submit(); assert.equal(saved.length, 0);
    assert.ok(mount.text().includes('Signal is required.'));
    await mount.input('title', 'A real pre-sale');
    await mount.choose('kind', 'pre-sale');
    assert.ok(mount.by('cycle-form-amount'));
    assert.equal(mount.props(mount.by('cycle-form-amount')).placeholder, '$100');
    await mount.input('amount', '12.50');
    const file = { name: 'proof.pdf', type: 'application/pdf', size: 12 };
    await mount.input('proof', file);
    await mount.choose('kind', 'waitlist');
    await mount.submit(); assert.equal(saved.length, 1);
    assert.equal(saved[0].title, 'A real pre-sale'); assert.deepEqual(saved[0].evidence, ['one', 'two']);
    assert.equal(saved[0].proof, file); assert.ok(!Object.hasOwn(saved[0], 'amount'));
  } finally { await mount.unmount(); }
}
test('real inputs, chips, checks, notes, paired fields and files update and validate', async () => {
  await assertFields({ default: FormLightbox });
  await mutationCheck(source, path, assertFields, [
    ['note(values) : note', "'A fixed note' : note"],
    ['if (!fieldVisible(field, values)) return null;', 'if (false) return null;'],
    ['setValue(field.name, option.value);', "setValue(field.name, 'invented');"],
    ['if (Object.keys(found).length) return;', 'if (false) return;'],
    ['onSubmit(submittedValues(fields, values))', 'onSubmit(values)'],
    ['event.target.files?.[0] ?? null', 'null'],
  ]);
});

async function assertOptions(m) {
  let resolve; let writes = 0;
  const promise = new Promise((r) => { resolve = r; });
  const form = { title: 'Choose a connector', fields: [{ name: 'choice', kind: 'CH', k: 'Connector', required: true, opts: [] }] };
  const mount = await mountForm(h(m.default, { ...props, form, loadOptions: () => promise, onSubmit: async () => { writes++; } }));
  try {
    assert.ok(mount.by('cycle-form-loading')); assert.ok(!mount.by('cycle-form-choice'));
    assert.equal(mount.props(mount.by('cycle-form-save')).disabled, true);
    await mount.submit(); assert.equal(writes, 0);
    await act(async () => resolve({ choice: { options: [{ value: 'none', label: 'None', checked: true }], note: { text: 'No connected Bank tool is enabled for this company.', href: '/build/connect?project_id=3' } } }));
    assert.ok(!mount.by('cycle-form-loading')); assert.ok(mount.by('cycle-form-choice'));
    assert.ok(mount.text().includes('No connected Bank tool is enabled for this company.'));
    const link = mount.nodes().find((n) => n.tagName === 'A');
    assert.equal(mount.props(link).href, '/build/connect?project_id=3');
    assert.equal(mount.props(mount.by('cycle-form-choice')).checked, true);
    await mount.submit(); assert.equal(writes, 1);
  } finally { await mount.unmount(); }
  const refused = await mountForm(h(m.default, { ...props, form, loadOptions: async () => { throw Error('You cannot read this venture.'); }, onSubmit: async () => { writes++; } }));
  try {
    await refused.flush();
    assert.ok(refused.text().includes('You cannot read this venture.'));
    assert.equal(refused.props(refused.by('cycle-form-save')).disabled, true);
    assert.ok(!refused.by('cycle-form-choice'));
    await refused.submit(); assert.equal(writes, 1);
  } finally { await refused.unmount(); }
}
test('options load before fields, supply defaults/notes, and a refusal prevents saving', async () => {
  await assertOptions({ default: FormLightbox });
  await mutationCheck(source, path, assertOptions, [
    ["useState(loadOptions ? undefined : {})", 'useState({})'],
    ['busy || !loaded} data-testid="cycle-form-save"', 'busy} data-testid="cycle-form-save"'],
    ['setValues(formValues(formFields(base, result), current, queryValues));', ''],
    ['setRefusal(error?.message ||', "setRefusal('Wrong sentence' ||"],
  ]);
});

async function assertSave(m) {
  const form = { title: 'Edit channel', cta: 'Save', fields: [{ name: 'name', type: 'text', label: 'Name', required: true }], fromQuery: (q) => ({ name: q.get('name') }) };
  const sent = []; let closed = 0; let saved = 0; let reject = 'field'; let release;
  const mount = await mountForm(h(m.default, { ...props, form, search: '?name=Query%20name', onClose: () => { closed++; }, onSaved: () => { saved++; }, onSubmit: async (v) => {
    sent.push(v);
    if (reject === 'field') throw Object.assign(Error('Use another name.'), { field: 'name' });
    if (reject === 'plan') throw Object.assign(Error('Raise + Grow is required.'), { status: 402, code: 'tier_required' });
    if (reject === 'busy') return new Promise((r) => { release = r; });
    return { ok: true };
  } }));
  try {
    assert.equal(mount.props(mount.by('cycle-form-name')).value, 'Query name');
    await mount.submit();
    assert.ok(mount.text().includes('Use another name.')); assert.equal(mount.props(mount.by('cycle-form-name'))['aria-invalid'], 'true');
    assert.equal(closed, 0); assert.equal(saved, 0);
    reject = 'plan'; await mount.submit();
    assert.ok(mount.by('cycle-form-refusal')); assert.ok(mount.text().includes('Raise + Grow is required.'));
    assert.equal(mount.props(mount.by('cycle-form-name')).value, 'Query name'); assert.equal(closed, 0);
    reject = 'busy';
    const formNode = mount.nodes().find((n) => n.tagName === 'FORM');
    let pending;
    await act(async () => { pending = mount.props(formNode).onSubmit({ preventDefault() {} }); });
    assert.equal(mount.props(mount.by('cycle-form-save')).disabled, true); assert.ok(mount.text().includes('Saving…'));
    await mount.submit(); assert.equal(sent.length, 3, 'busy form sends once');
    await act(async () => { release({ ok: true }); await pending; });
    assert.equal(saved, 1); assert.equal(closed, 1);
  } finally { await mount.unmount(); }
}
test('query defaults, field/plan refusals, busy state and success callbacks are preserved', async () => {
  await assertSave({ default: FormLightbox });
  await mutationCheck(source, path, assertSave, [
    ["base.fromQuery(new URLSearchParams(search))", '{}'],
    ['setErrors({ [error.field]: sentence })', 'setRefusal(sentence)'],
    ['onSaved?.(result);', ''],
    ['if (!completion) onClose?.();', 'if (false) onClose?.();'],
    ["error?.message || 'This could not be saved. Try again.'", "'Wrong refusal'"],
  ]);
});

async function assertDone(m) {
  let closed = 0; let saved = 0; let payload;
  const f = { title: 'Add founder', fields: [], cta: 'Add founder', done: () => ({ text: 'Founder saved.', href: '/raise/legal-engine/founders', copy: 'synthetic-share-link' }) };
  const mount = await mountForm(h(m.default, { ...props, form: f, onSubmit: async (v) => { payload = v; return { ok: true }; }, onSaved: () => { saved++; }, onClose: () => { closed++; } }));
  try {
    assert.ok(mount.by('cycle-form-save')); await mount.submit();
    assert.deepEqual(payload, {}); assert.equal(saved, 1); assert.equal(closed, 0);
    assert.ok(mount.by('cycle-form-done')); assert.ok(mount.text().includes('Founder saved.'));
    assert.ok(mount.text().includes('synthetic-share-link')); assert.ok(!mount.by('cycle-form-save'));
    const link = mount.nodes().find((n) => n.tagName === 'A');
    assert.equal(mount.props(link).href, '/raise/legal-engine/founders');
    await mount.click('Close'); assert.equal(closed, 1);
  } finally { await mount.unmount(); }
}
test('fieldless forms submit and a done view remains open with the returned link', async () => {
  await assertDone({ default: FormLightbox });
  await mutationCheck(source, path, assertDone, [
    ['if (completion) setDone(completion);', 'if (false) setDone(completion);'],
    ['if (!completion) onClose?.();', 'onClose?.();'],
    ['linkOf(done.href) &&', 'false &&'],
  ]);
});

async function assertLegacy(m) {
  for (const [cycle, modules] of Object.entries(FORMS)) for (const [slug, entries] of Object.entries(modules)) {
    for (const form of Array.isArray(entries) ? entries : [entries]) {
      const out = renderToStaticMarkup(h(m.default, { form, cycle, slug, onSubmit() {}, onClose() {} }));
      assert.ok(out.includes('role="dialog"')); assert.ok(out.includes(form.title));
      assert.ok(out.includes(MODULES[cycle].find((m) => m.slug === slug).name));
    }
  }
  for (const [cycle, modules] of Object.entries(EDITS)) for (const [slug, form] of Object.entries(modules)) {
    const out = renderToStaticMarkup(h(m.default, { form, cycle, slug, onSubmit() {}, onClose() {} }));
    assert.ok(out.includes(form.title)); assert.ok(!out.includes('· required'));
  }
  const connector = EDITS.build['operating-systems'];
  const mount = await mountForm(h(m.default, { form: connector, cycle: 'build', slug: 'operating-systems', onSubmit() {}, onClose() {}, loadOptions: async () => ({ choice: systemOptions({ kinds: [] }, 'bank', 3) }) }));
  try { await mount.flush(); assert.ok(mount.text().includes('No connected Bank tool is enabled for this company.')); } finally { await mount.unmount(); }
}
test('every legacy Add and Edit registry entry renders without changing its copy or registry', async () => {
  await assertLegacy({ default: FormLightbox });
  await mutationCheck(source, path, assertLegacy, [
    ['label={base.title} eyebrow={eyebrow} title={base.title}', 'label={base.title} eyebrow="" title=""'],
    ['note={field.note ?? field.hint}', 'note={null}'],
  ]);
});

async function assertPage(m) {
  let closed = 0;
  const element = (extra = {}) => h(m.default, { pageBelow: 'lg', title: 'New theme', label: 'New theme', eyebrow: 'Validate · Problem discovery', sub: 'Group the evidence.', onClose: () => { closed++; }, ...extra }, h('input', { name: 'title' }));
  const mount = await mountForm(element(), { phone: true, modal: true });
  try {
    assert.ok(mount.by('lightbox-page')); assert.ok(!mount.by('lightbox')); assert.ok(!mount.by('lightbox-backdrop'));
    assert.equal(mount.keys.length, 0); assert.equal(scrollLocks(), 0);
    assert.equal(mount.opener.hasAttribute('inert'), false);
    assert.ok(mount.text().includes('‹ Problem discovery')); assert.ok(mount.text().includes('Group the evidence.'));
    await mount.escape(); assert.equal(closed, 0);
    await mount.click('‹ Problem discovery'); assert.equal(closed, 1);
    await mount.render(element({ bar: h('div', { 'data-testid': 'custom-bar' }, 'Custom cycle bar') }));
    assert.ok(mount.by('custom-bar')); assert.ok(!mount.by('lightbox-back'));
    await mount.setPhone(false);
    assert.ok(mount.by('lightbox')); assert.equal(mount.keys.length, 1); assert.equal(scrollLocks(), 1);
    assert.equal(mount.opener.hasAttribute('inert'), true);
    await mount.setPhone(true);
    assert.ok(mount.by('lightbox-page')); assert.equal(mount.keys.length, 0); assert.equal(scrollLocks(), 0);
    assert.equal(mount.opener.hasAttribute('inert'), false);
    await mount.render(element({ pageBelow: undefined }));
    assert.ok(mount.by('lightbox')); assert.ok(!mount.by('lightbox-page'));
    assert.equal(mount.keys.length, 1); assert.equal(scrollLocks(), 1);
  } finally { await mount.unmount(); }
  assert.equal(scrollLocks(), 0);
}
test('opt-in page mode starts at phone width and restores modal effects when widened', async () => {
  await assertPage({ default: Lightbox });
  await mutationCheck(shellSource, 'ui/Lightbox.jsx', assertPage, [
    ["pageBelow === 'lg' && phone", "pageBelow === 'lg'"],
    ['[id, initialFocus, returnFocusTo, page]', '[id, initialFocus, returnFocusTo]'],
    ['{bar || <header', '{null || <header'],
    ["pageBelow === 'lg' && phone", 'phone'],
  ]);
});

async function assertBar(m) {
  const mount = await mountForm(h(m.default, { ...props, form: fixture(), bar: h('div', { 'data-testid': 'form-bar' }, 'The supplied bar'), onSubmit() {} }), { phone: true, modal: true });
  try {
    assert.ok(mount.by('form-bar')); assert.ok(mount.by('cycle-form-page'));
    assert.ok(mount.props(mount.by('cycle-form-save')).className.includes('max-lg:h-[52px]'));
    assert.equal(mount.keys.length, 0);
  } finally { await mount.unmount(); }
}
test('FormLightbox forwards a phone bar and keeps the 52px CTA', async () => {
  await assertBar({ default: FormLightbox });
  await mutationCheck(source, path, assertBar, [
    ['testId="cycle-form" bar={bar}', 'testId="cycle-form"'],
    ['max-lg:h-[52px]', 'max-lg:h-9'],
  ]);
});

async function assertModal(m) {
  let outerClosed = 0; let innerClosed = 0;
  const outer = (nested = false) => h(m.default, { title: 'Outer', label: 'Outer', testId: 'outer', onClose: () => { outerClosed++; } },
    h('button', null, 'First'), h('button', null, 'Last'),
    nested ? h(m.default, { title: 'Inner', label: 'Inner', testId: 'inner', onClose: () => { innerClosed++; } }, h('button', null, 'Inner control')) : null);
  const mount = await mountForm(outer(), { modal: true });
  try {
    assert.equal(mount.props(mount.by('outer'))['aria-label'], 'Outer');
    const headers = mount.nodes().filter((n) => n.tagName === 'HEADER');
    assert.ok(headers.some((n) => mount.props(n).className.includes('px-5 py-[18px]')));
    assert.equal(mount.body.style.overflow, 'hidden'); assert.equal(mount.opener.hasAttribute('inert'), true);
    const box = mount.by('outer'); const controls = box.querySelectorAll('controls');
    document.activeElement = controls.at(-1);
    let prevented = false;
    mount.props(box).onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(document.activeElement, controls[0]);
    await mount.render(outer(true)); assert.equal(scrollLocks(), 2);
    await mount.escape(); assert.equal(innerClosed, 1); assert.equal(outerClosed, 0);
    await mount.render(outer(false)); assert.equal(scrollLocks(), 1);
    await mount.escape(); assert.equal(outerClosed, 1);
  } finally { await mount.unmount(); }
  assert.equal(mount.body.style.overflow, 'auto'); assert.equal(scrollLocks(), 0);
  assert.equal(mount.opener.hasAttribute('inert'), false); assert.equal(mount.doc.activeElement, mount.opener);
}
test('desktop keeps focus trap, inert, scroll lock, top-only Escape and focus return', async () => {
  await assertModal({ default: Lightbox });
  await mutationCheck(shellSource, 'ui/Lightbox.jsx', assertModal, [
    ["const release = lockScroll(document.body);", 'const release = () => {};'],
    ['const restore = inertOutside(el, document.body);', 'const restore = () => {};'],
    ['|| !topmost(id)', ''],
    ['e.preventDefault();\n    (to === -1', '(to === -1'],
    ['opener.focus?.();', 'void opener;'],
    ['px-5 py-[18px]', 'px-5 py-4'],
  ]);
});

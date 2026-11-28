/**
 * D8775 (#8775): Add must-have reuses a feature from Solution design instead of a second, retyped row, and
 * an empty owner list says why and where to add a teammate.
 *
 * The real `FormLightbox` and the real `forms.js` spec, with a stubbed write table and a stubbed
 * `form-options` read. Each group runs on `forms.js`, on mutants of it that must fail, and again.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_feature_path_8775.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

const path = 'pages/cycles/forms.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const P = 3;

/** Prototype / MVP's form-options read, as `records/build.ts` answers it (made-up names). */
const READ = {
  hypothesis_id: { options: [{ value: '30', label: 'H2 · Clinics book faster with a form' }], empty: 'None yet' },
  owner_user_id: { options: [{ value: '12', label: 'Iris Sample' }], empty: 'None yet' },
  feature_id: { options: [{ value: '7', label: 'Customer intake form' }], empty: 'None yet' },
};

async function mount(m, read = READ) {
  const calls = [];
  const w = {
    formOptions: async () => read,
    build: new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { id: 7 }; } }),
  };
  const form = m.BUILD_FORMS['prototype-mvp'][0];
  const ui = await mountForm(h(FormLightbox, { form, cycle: 'build', slug: 'prototype-mvp', onSubmit: (v) => form.submit(w, P, v), onClose() {},
    loadOptions: () => form.loadOptions(w, P) }));
  await ui.flush();
  const named = (name) => ui.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === name);
  return { ...ui, calls, named };
}

async function promotes(m) {
  const ui = await mount(m);
  try {
    assert.deepEqual(ui.named('feature_id').map((n) => propsOf(n).value), ['', '7'], 'A new one, then the features not yet must-haves');
    assert.ok(ui.named('title').length > 0, 'A new one asks for a title');
    assert.equal(ui.named('roadmap').length, 0, 'Also on the roadmap is offered only for a feature');
    await ui.choose('feature_id', '7');
    assert.equal(ui.named('title').length, 0, 'a chosen feature brings its title: nothing is retyped');
    assert.equal(ui.named('hypothesis_id').length, 0, 'and its hypothesis');
    assert.ok(ui.text().includes('Its title, pain theme, hypothesis and success bar come with it. Nothing is retyped.'));
    await ui.choose('roadmap', 'next');
    await ui.choose('owner_user_id', '12');
    await ui.submit();
    assert.equal(ui.calls.length, 1, 'sent without a title');
    const [name, project, body] = ui.calls[0];
    assert.equal(name, 'addMustHave');
    assert.equal(project, P);
    assert.equal(body.feature_id, 7);
    assert.equal(body.roadmap, 'next');
    assert.equal(body.owner_user_id, 12);
    assert.ok(body.title == null, 'no retyped title');
  } finally { await ui.unmount(); }
  const fresh = await mount(m);
  try {
    await fresh.submit();
    assert.equal(fresh.calls.length, 0, 'a new must-have still needs its title');
    await fresh.input('title', 'Booking link');
    await fresh.submit();
    assert.equal(fresh.calls.length, 1);
    assert.equal(Object.hasOwn(fresh.calls[0][2], 'feature_id'), false, 'a new one names no feature');
    assert.equal(Object.hasOwn(fresh.calls[0][2], 'roadmap'), false);
  } finally { await fresh.unmount(); }
}

test('Add must-have from Solution design sends the feature, not a retyped title, and A new one keeps today\'s form', async () => {
  await mutationCheck(source, path, promotes, [
    ["...mustHaveFields.map((f) => (f.name === 'title' || f.name === 'hypothesis_id' ? { ...f, when: (v) => !fromFeature(v) } : f)),", '...mustHaveFields,'],
    ["...(fromFeature(v) ? { feature_id: idOrNull(v.feature_id), ...(v.roadmap ? { roadmap: v.roadmap } : {}) } : {}) }),", '}),'],
    ["feature_id: { options: [NEW_MUST, ...readChips(read, 'feature_id')], def: 0 } })),", '})),'],
    ["opts: ALSO_ROADMAP, def: 0, when: fromFeature },", 'opts: ALSO_ROADMAP, def: 0 },'],
  ]);
});

async function explainsEmpty(m) {
  const empty = { ...READ, owner_user_id: { options: [], empty: 'None yet',
    note: { text: 'No one can own this yet.', href: `/projects/${P}/settings/team`, link: 'Add a teammate' } } };
  const ui = await mount(m, empty);
  try {
    assert.ok(ui.text().includes('No one can own it yet: an owner is on this project’s team or in its company.'), 'the empty list says why');
    const link = ui.nodes().find((n) => n.tagName === 'A' && propsOf(n).href === `/projects/${P}/settings/team`);
    assert.ok(link, 'and links the project’s team');
    assert.ok(ui.text().includes('Add a teammate'));
    await ui.input('title', 'Booking link');
    await ui.submit();
    assert.equal(ui.calls.length, 1, 'it can still be saved without an owner');
    assert.equal(Object.hasOwn(ui.calls[0][2], 'owner_user_id'), false);
  } finally { await ui.unmount(); }
  const listed = await mount(m);
  try {
    assert.equal(listed.nodes().some((n) => n.tagName === 'A' && propsOf(n).href === `/projects/${P}/settings/team`), false, 'no link when someone can own it');
  } finally { await listed.unmount(); }
}

test('an empty owner list says why, links the project’s team, and the must-have still saves', async () => {
  await mutationCheck(source, path, explainsEmpty, [
    ["optionsFrom: 'owners', empty: NO_OWNER }", "optionsFrom: 'owners', empty: 'No member to choose yet.' }"],
    ["return { options: readChips(read, 'owner_user_id'), ...link };", "return { options: readChips(read, 'owner_user_id') };"],
  ]);
});

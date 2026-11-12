/** D4836: Offers saves the programme once, then retries only its logo against the original uid and file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import TestingZone from '../src/pages/partner/offers/TestingZone.jsx';

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const file = { name: 'synthetic-logo.png', size: 32, type: 'image/png' };
const programme = (uid, extra = {}) => ({ uid, product_name: `Programme ${uid}`, status: 'draft', places: 2, eligible_roles: ['founder'], applicant_count: 0, picked_count: 0, ...extra });
const failure = () => Object.assign(new Error('Arbitrary internal upload detail'), { status: 500 });
function fakeApi(initial = []) {
  const s = { items: [...initial], creates: [], edits: [], uploads: [], removals: [], failLogo: false, failRead: false, pending: null };
  s.api = {
    programmes: async () => { if (s.failRead) throw new Error('Synthetic read failure'); return { items: s.items }; },
    create: async (payload) => { s.creates.push(payload); const p = programme(`p${s.creates.length}`, payload); s.items.push(p); return { programme: p }; },
    edit: async (uid, payload) => { s.edits.push([uid, payload]); const p = { ...s.items.find((x) => x.uid === uid), ...payload }; s.items = s.items.map((x) => x.uid === uid ? p : x); return { programme: p }; },
    uploadLogo: async (uid, chosen) => { s.uploads.push([uid, chosen]); if (s.pending) await s.pending; if (s.failLogo) throw failure(); return { logo: { logo_key: `logo-${uid}` } }; },
    removeLogo: async (uid) => { s.removals.push(uid); if (s.failLogo) throw failure(); return { logo: { logo_key: null } }; },
  };
  return s;
}
async function mounted(api) {
  const restore = installDocument('', { focus: true });
  const media = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.children = []; return n; };
  document.body.style = { overflow: '', paddingRight: '' };
  const node = document.createElement('div'); document.body.appendChild(node);
  const root = createRoot(node);
  await act(async () => { root.render(h(MemoryRouter, null, h(TestingZone, { api }))); await flush(); });
  const walk = (n) => [n, ...(n.childNodes ?? []).flatMap(walk)];
  const props = (n) => Object.entries(n ?? {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] ?? {};
  const nodes = () => walk(document.body);
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const text = (n = document.body) => n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
  return {
    by, props, nodes, text,
    async press(n) { assert.ok(n, 'button exists'); assert.ok(!props(n).disabled, 'button enabled'); await act(async () => { props(n).onClick?.({ preventDefault() {} }); await flush(); }); },
    async value(id, value) { await act(async () => { props(by(id)).onChange({ target: { value } }); await flush(); }); },
    async file(chosen) { await act(async () => { props(by('programme-logo-file')).onChange({ target: { files: [chosen] } }); await flush(); }); },
    async submit() { await act(async () => { props(by('programme-form')).onSubmit({ preventDefault() {} }); await flush(); }); },
    async retry() { await this.press(nodes().find((n) => n.tagName === 'BUTTON' && text(n) === 'Retry')); },
    async settle() { await act(flush); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = media; restore(); },
  };
}
async function createWithLogo(ui) {
  await ui.press(ui.by('testing-new-programme'));
  await ui.value('programme-product_name', 'Synthetic programme'); await ui.value('programme-places', '2');
  await act(async () => { ui.props(ui.by('programme-role-founder')).onChange(); });
  await ui.file(file); await ui.submit();
}

test('programme persists through logo failure and a failed list refresh; Retry uploads only the original file/uid', async () => {
  const s = fakeApi(); s.failLogo = true;
  const ui = await mounted(s.api);
  try {
    // The independent logo result remains reachable even if the list read fails.
    const create = s.api.create; s.api.create = async (p) => { const out = await create(p); s.failRead = true; return out; };
    await createWithLogo(ui);
    assert.equal(s.creates.length, 1); assert.equal(s.items.length, 1);
    assert.ok(!ui.by('programme-form'), 'the persisted programme is not offered for a duplicate create');
    assert.match(ui.text(), /Synthetic programme is saved. Its logo was not uploaded/);
    assert.equal(ui.props(document.activeElement)['data-testid'], 'testing-logo-status-p1', 'partial success focuses its retry result');
    assert.doesNotMatch(ui.text(), /Arbitrary internal upload detail/);
    s.failLogo = false; s.failRead = false; await ui.retry();
    assert.equal(s.creates.length, 1); assert.equal(s.edits.length, 0);
    assert.deepEqual(s.uploads.map(([uid]) => uid), ['p1', 'p1']);
    assert.ok(s.uploads.every(([, chosen]) => chosen === file), 'retry retains the selected File');
    assert.ok(!ui.by('testing-logo-status-p1'));
    assert.equal(ui.props(document.activeElement)['data-testid'], 'testing-programme-p1', 'logo-only completion returns to the saved programme');
    assert.match(ui.text(), /Its logo was uploaded/);
  } finally { await ui.close(); }
});

test('an edit that removes a logo retries only removal and never saves the programme twice', async () => {
  const s = fakeApi([programme('existing', { logo_key: 'old-logo' })]); s.failLogo = true;
  const ui = await mounted(s.api);
  try {
    await ui.press(ui.by('testing-edit-existing')); await ui.press(ui.by('programme-logo-remove')); await ui.submit();
    assert.equal(s.edits.length, 1); assert.equal(s.creates.length, 0); assert.deepEqual(s.removals, ['existing']);
    assert.match(ui.text(), /logo was not removed/);
    s.failLogo = false; await ui.retry();
    assert.deepEqual(s.removals, ['existing', 'existing']); assert.equal(s.edits.length, 1); assert.equal(s.uploads.length, 0);
  } finally { await ui.close(); }
});

test('a pending logo retry stays bound to its programme while another editor opens', async () => {
  const s = fakeApi([programme('other')]); s.failLogo = true;
  const ui = await mounted(s.api);
  try {
    await createWithLogo(ui);
    let release; s.pending = new Promise((resolve) => { release = resolve; }); s.failLogo = false;
    const duplicateRetry = ui.props(ui.nodes().find((n) => n.tagName === 'BUTTON' && ui.text(n) === 'Retry')).onClick;
    await ui.retry();
    await act(async () => { duplicateRetry(); await flush(); });
    await ui.press(ui.by('testing-edit-other'));
    assert.equal(ui.props(ui.by('programme-product_name')).value, 'Programme other');
    await act(async () => { release(); await flush(); }); await ui.settle();
    assert.deepEqual(s.uploads.map(([uid]) => uid), ['p1', 'p1']);
    assert.equal(ui.props(ui.by('programme-product_name')).value, 'Programme other');
    assert.equal(s.creates.length, 1); assert.equal(s.edits.length, 0);
  } finally { await ui.close(); }
});

test('the enabled logo control has a programmatic label, description and associated file error', async () => {
  const s = fakeApi(); const ui = await mounted(s.api);
  try {
    await ui.press(ui.by('testing-new-programme'));
    const input = ui.props(ui.by('programme-logo-file'));
    assert.ok(ui.nodes().some((n) => n.tagName === 'LABEL' && ui.props(n).htmlFor === input.id));
    await ui.file({ name: 'not-a-logo.txt', size: 12, type: 'text/plain' });
    const invalid = ui.props(ui.by('programme-logo-file'));
    assert.equal(invalid['aria-invalid'], true);
    const described = invalid['aria-describedby'].split(' ');
    assert.ok(described.every((id) => ui.nodes().some((n) => ui.props(n).id === id)));
    assert.match(ui.text(), /A logo is a PNG or an SVG file/);
    assert.equal(s.creates.length, 0); assert.equal(s.uploads.length, 0);
  } finally { await ui.close(); }
});

test('a first logo upload finishing late cannot close a different programme editor', async () => {
  const s = fakeApi([programme('other')]);
  let release; s.pending = new Promise((resolve) => { release = resolve; });
  const ui = await mounted(s.api);
  try {
    await createWithLogo(ui);
    await ui.press(ui.by('programme-cancel'));
    await ui.press(ui.by('testing-edit-other'));
    await act(async () => { release(); await flush(); }); await ui.settle();
    assert.ok(ui.by('programme-form'), 'the later editor remains open');
    assert.equal(ui.props(ui.by('programme-product_name')).value, 'Programme other');
    assert.equal(s.creates.length, 1); assert.equal(s.uploads[0][0], 'p1');
  } finally { await ui.close(); }
});

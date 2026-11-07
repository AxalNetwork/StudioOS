// #4660 (finding 4): a record's Email action opens the right person's composer.
// The real producer (CycleRoute's Email action) is mounted against the real
// consumer (RecordEmailSheet); only the network is stubbed. Every record and
// address is made up, and nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';
import { isPersonRef, personOfRecord } from '../src/pages/email/emailModel.js';
import RecordEmailSheet, { UNREADABLE } from '../src/pages/email/RecordEmailSheet.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { h, propsOf, textOf } from './_form_d695.mjs';

const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];

// The four record kinds that have a person: [cycle, slug, record id, the ref the Worker's context read takes].
const KINDS = [
  ['validate', 'customer-research', '11', 'interviewee:11'],
  ['raise', 'capital-relationships', '7', 'prospect:7'],
  ['build', 'founding-team', 'h-4', 'cofounder:h-4'],
  ['grow', 'partner-network', 'gp-north', 'growth_partner:gp-north'],
];

function CycleAt() { const { cycle } = useParams(); return h(CycleRoute, { cycle, record: true }); }

async function mountRecord(cycle, slug, id, ref, { phone = false, holdContext = false } = {}) {
  const restore = installDocument();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const fetchBefore = globalThis.fetch;
  const calls = [];
  const person = { ref, kind: ref.split(':')[0], name: 'Ada Lovelace', relationship: 'customer', address: 'ada@example.test' };
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url);
    calls.push({ path, method: opts.method || 'GET' });
    let body = {};
    if (path.includes('/mail/context') && holdContext) return new Promise(() => {});
    if (path.includes('/mail/context')) body = { person, items: [{ ref: 'note:1', label: 'Note', selected: true }] };
    else if (path.includes('/mail/accounts')) body = { accounts: [{ uid: 'acc-1', address: 'me@example.test', status: 'active', can_send: true }], providers: {} };
    else if (path.includes('/mail/shares')) body = { items: [] };
    else if (path.includes(`/records/${id}`) && !path.includes('/activity')) body = { id, title: 'Ada Lovelace', sub: 'Interview', fields: [], sections: [], actions: [] };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [`/${cycle}/${slug}/${id}?project_id=3`] },
    h(Routes, null, h(Route, { path: '/:cycle/:slug/:id', element: h(CycleAt) })))));
  await settle();
  const all = () => walk(document.body);
  return {
    calls, all,
    has: (testId) => all().some((n) => propsOf(n)['data-testid'] === testId),
    by: (testId) => all().find((n) => propsOf(n)['data-testid'] === testId),
    text: () => textOf(document.body),
    async press(node, event = {}) { await act(async () => propsOf(node).onClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event })); await settle(); },
    contexts: () => calls.filter((c) => c.path.includes('/mail/context')).map((c) => decodeURIComponent(new URL(c.path, 'https://x.test').searchParams.get('person') ?? 'NONE')),
    async close() { await act(async () => root.unmount()); globalThis.fetch = fetchBefore; globalThis.matchMedia = media; restore(); },
  };
}

test('the contract: personOfRecord gives a ref for each supported kind, and only a ref reaches the Sheet', () => {
  for (const [cycle, slug, id, ref] of KINDS) {
    assert.equal(personOfRecord(cycle, slug, id), ref, `${cycle}/${slug}`);
    assert.equal(isPersonRef(ref), true, ref);
  }
  for (const bad of [undefined, null, '', {}, { ref: 'interviewee:11', name: 'Ada' }, 'interviewee', 'interviewee:', ':11', 'a b:1', 'interviewee:11/../x']) assert.equal(isPersonRef(bad), false, JSON.stringify(bad));
});

for (const [cycle, slug, id, ref] of KINDS) {
  test(`the real Email action on a ${cycle}/${slug} record asks for ${ref} and opens its composer, on the record's own URL`, async () => {
    const page = await mountRecord(cycle, slug, id, ref);
    try {
      const action = page.by('email-action');
      assert.ok(action, 'the record offers Email');
      await page.press(action);
      assert.deepEqual(page.contexts(), [ref], 'the context request names the person, never undefined');
      assert.ok(page.has('record-compose'), 'the composer opened');
      assert.equal(page.has('record-email-state') && /Unreadable/.test(page.text()), false, 'not the unreadable state');
      assert.match(page.text(), /Email to Ada Lovelace/);
    } finally { await page.close(); }
  });
}

test('a modified click leaves the sheet alone (the deep link opens in a new tab); the link is still /email?person=…&compose=1', async () => {
  const page = await mountRecord('validate', 'customer-research', '11', 'interviewee:11');
  try {
    const action = page.by('email-action');
    assert.match(propsOf(action).href ?? '', /\/email\?person=interviewee%3A11&compose=1/);
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) await page.press(action, mod);
    assert.deepEqual(page.contexts(), [], 'no sheet, no context read');
    assert.equal(page.has('record-compose'), false);
  } finally { await page.close(); }
});

test('a Sheet handed anything but a ref asks nothing and says it is unreadable', async () => {
  for (const bad of [undefined, { ref: 'interviewee:11', name: 'Ada' }, '']) {
    const calls = [];
    const api = { accounts: () => { calls.push('accounts'); return Promise.resolve({ accounts: [] }); }, shares: () => { calls.push('shares'); return Promise.resolve({ items: [] }); }, context: (r) => { calls.push(['context', r]); return Promise.resolve({}); } };
    const restore = installDocument();
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const create = document.createElement.bind(document);
    document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
    document.body.style = { overflow: 'auto', paddingRight: '' };
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(h(MemoryRouter, null, h(RecordEmailSheet, { person: bad, onClose() {}, api }))));
    await settle();
    try {
      assert.deepEqual(calls, [], `no request for ${JSON.stringify(bad)}`);
      assert.ok(textOf(document.body).includes(UNREADABLE));
    } finally { await act(async () => root.unmount()); restore(); }
  }
});

test('while the person is still being read the Sheet carries the record\'s own label, not "undefined"', async () => {
  const restore = installDocument();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const never = new Promise(() => {});
  const api = { accounts: () => never, shares: () => never, context: () => never };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(RecordEmailSheet, { person: 'interviewee:11', label: 'Ada Lovelace', onClose() {}, api }))));
  await settle();
  try {
    const text = textOf(document.body);
    assert.match(text, /Email to Ada Lovelace/);
    assert.doesNotMatch(text, /undefined/);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('the record\'s own title labels the Sheet from the first moment, while the person is still being read', async () => {
  const page = await mountRecord('validate', 'customer-research', '11', 'interviewee:11', { holdContext: true });
  try {
    await page.press(page.by('email-action'));
    assert.deepEqual(page.contexts(), ['interviewee:11']);
    assert.equal(page.has('record-compose'), false, 'still reading');
    assert.match(page.text(), /Email to Ada Lovelace/, 'the record title, from CycleRoute');
    assert.doesNotMatch(page.text(), /Email to this person/);
  } finally { await page.close(); }
});

test('on a phone the record\'s ⋯ menu offers Email, and it opens the same Sheet for the same person', async () => {
  const page = await mountRecord('validate', 'customer-research', '11', 'interviewee:11', { phone: true });
  try {
    assert.equal(page.has('email-action'), false, 'the phone has no header button');
    await page.press(page.by('record-header-more'));
    const item = page.by('record-header-email');
    assert.ok(item, 'the ⋯ menu offers Email');
    await page.press(item);
    assert.deepEqual(page.contexts(), ['interviewee:11']);
    assert.ok(page.has('record-compose'));
  } finally { await page.close(); }
});

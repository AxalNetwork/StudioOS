/**
 * #4017 (#3710 IV-D3, D1454 §1 Q2 A): a record's Email composes in the right
 * Sheet over the record. Every person and address is made up.
 *
 *   · a plain click on Email opens the Sheet and never navigates, so the URL
 *     stays on the record; a new-tab click still follows the `/email` link;
 *   · the Sheet reads what `/email` reads and opens the composer;
 *   · the deep link `/email?person=…&compose=1` still composes;
 *   · no other member's address shows: a member who has not shared an
 *     address gets a line, never a composer, and the pack's address is never
 *     drawn;
 *   · the record's ⋯ (phone rows, the interview record's menu) opens the same
 *     Sheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { EmailAction } from '../src/pages/email/emailParts.jsx';
import RecordEmailSheet, { NOT_SHARED, UNREADABLE } from '../src/pages/email/RecordEmailSheet.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

async function mounted(element) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/validate/customer-research/11?project_id=1'] }, element)));
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  return {
    text: () => text(document.body),
    testIds: () => walk(document.body).map((n) => props(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

function fakeApi({ person, shares = [], fail = false } = {}) {
  const calls = [];
  const ok = (name, value) => (...args) => { calls.push([name, ...args]); return fail && name === 'context' ? Promise.reject(new Error('down')) : Promise.resolve(value); };
  return {
    calls,
    accounts: ok('accounts', { accounts: [{ uid: 'acc-1', address: 'me@example.test', status: 'active', can_send: true }] }),
    shares: ok('shares', { items: shares }),
    context: ok('context', { person, items: [{ ref: 'interview:11', label: 'Interview', selected: true }, { ref: 'note:3', label: 'Note', selected: false }] }),
    estimate: ok('estimate', { estimate: { hold_microusd: 20_000, model: 'm' } }),
    draft: ok('draft', {}),
  };
}

test('a plain click on Email opens the Sheet and does not navigate; a new-tab click follows the link', () => {
  let opened = 0;
  const el = EmailAction({ person: 'interviewee:11', from: 'Ada · Customer research', onOpen: () => { opened += 1; } });
  assert.match(el.props.to, /^\/email\?person=interviewee%3A11&compose=1/, 'the link stays the deep link');
  const click = (extra = {}) => { const e = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; el.props.onClick(e); return e; };
  assert.equal(click().defaultPrevented, true, 'no navigation: the URL stays on the record');
  assert.equal(opened, 1);
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) assert.equal(click(mod).defaultPrevented, false, JSON.stringify(mod));
  assert.equal(opened, 1, 'a new-tab click opens nothing here');
  assert.equal(EmailAction({ person: 'interviewee:11' }).props.onClick, undefined, 'without onOpen, a plain link (the /email page and others)');
});

test('the Sheet reads what /email reads and opens the composer for the record\'s person', async () => {
  const person = { ref: 'interviewee:11', kind: 'interviewee', name: 'Ada Lovelace', relationship: 'customer', address: 'ada@example.test' };
  const api = fakeApi({ person });
  const page = await mounted(h(RecordEmailSheet, { person: { ref: 'interviewee:11', name: 'interviewee:11' }, from: 'Ada · Customer research', onClose() {}, api }));
  try {
    assert.ok(page.testIds().includes('compose-sheet'), page.testIds().join(','));
    assert.match(page.text(), /Email to Ada Lovelace/);
    assert.match(page.text(), /Opened from Ada · Customer research/);
    assert.deepEqual(api.calls.filter(([n]) => n === 'context').map(([, ref]) => ref), ['interviewee:11']);
    const estimate = api.calls.find(([n]) => n === 'estimate');
    assert.deepEqual(estimate?.[1]?.refs, ['interview:11'], 'only the records the pack selects, as /email starts');
  } finally { await page.close(); }
});

test('no other member\'s address: a member who has not shared one gets a line, never a composer', async () => {
  const member = { ref: 'member:u9', kind: 'member', name: 'Bo Member', relationship: 'member', address: 'leak@example.invalid' };
  const page = await mounted(h(RecordEmailSheet, { person: { ref: 'member:u9', name: 'Bo' }, onClose() {}, api: fakeApi({ person: member }) }));
  try {
    assert.match(page.text(), new RegExp(NOT_SHARED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!page.testIds().includes('compose-sheet'));
    assert.doesNotMatch(page.text(), /leak@example\.invalid/);
  } finally { await page.close(); }
});

test('an unreadable person reads Unreadable in the Sheet, never a blank composer', async () => {
  const page = await mounted(h(RecordEmailSheet, { person: { ref: 'interviewee:11', name: 'Ada' }, onClose() {}, api: fakeApi({ fail: true }) }));
  try {
    assert.match(page.text(), /Unreadable: this person’s records could not be read/);
    assert.equal(UNREADABLE.startsWith('Unreadable'), true);
    assert.ok(!page.testIds().includes('compose-sheet'));
  } finally { await page.close(); }
});

test('the record route mounts the Sheet; the header, the phone rows and the interview record\'s ⋯ open it', () => {
  const route = read('pages/cycles/CycleRoute.jsx');
  assert.match(route, /<EmailAction person=\{emailPerson\} from=\{emailFrom\} className=\{HEADER_BUTTON\.default\} onOpen=\{openEmail\} \/>/);
  assert.match(route, /onEmail=\{emailPerson \? openEmail : null\}/);
  assert.match(route, /\{emailing && emailPerson && <RecordEmailSheet person=\{emailPerson\} from=\{emailFrom\} onClose=\{\(\) => setEmailing\(false\)\} \/>\}/);
  assert.match(route, /setDialog\(null\); setEmailing\(false\);/, 'a new record closes the Sheet');
  assert.match(read('pages/cycles/RecordView.jsx'), /\{ key: 'email', title: 'Email', \.\.\.\(onEmail \? \{ onClick: onEmail \} : \{ href: emailTo \}\) \}/);
  assert.match(read('pages/founder/InterviewReviewPage.jsx'), /href: header\.emailTo, onSelect: header\.onEmail \|\| undefined/);
  assert.match(read('pages/cycles/RecordHeader.jsx'), /if \(item\.onSelect && isPlainClick\(event\)\) \{ event\.preventDefault\(\); item\.onSelect\(\); \}/);
});

test('the deep link still composes on /email', () => {
  const page = read('pages/email/EmailPage.jsx');
  assert.match(page, /useState\(params\.get\('compose'\) === '1'\)/);
  assert.match(page, /\{composing && !blocked && <ComposeSheet /);
});

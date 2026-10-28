/** D1345: the old address moves to Email once; former starters open scoped drafts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import MessagesRedirect, { MessagesMovedNotice } from '../src/pages/email/MessagesRedirect.jsx';
import { EmailGp } from '../src/pages/SpinoutLabLpCommitment.jsx';
import { recipientFor } from '../src/pages/email/emailModel.js';
const h = React.createElement;
const raw = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const store = () => { const data = new Map(); return { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v), data }; };
function Location() { const l = useLocation(); return h('output', null, l.pathname + l.search + l.hash); }
function Page({ userId, storage }) {
  return h(MessagesMovedNotice, { userId, storage }, h('div', null, 'Email workspace', h(Location)));
}
const routes = (userId, storage) => h(Routes, null,
  h(Route, { path: '/messages', element: h(MessagesRedirect) }),
  h(Route, { path: '/email', element: h(Page, { userId, storage }) }));

for (const button of ['Open Email', 'Dismiss']) test(`${button} acknowledges EM10, replaces the old address, and persists per account`, async () => {
  const storage = store();
  let view = await mountContracts(routes(11, storage), '/messages?thread=old&next=https://example.invalid#old');
  try {
    assert.match(view.text(), /Messages is now Email/);
    assert.match(view.text(), /Messages had no conversations to move/);
    assert.doesNotMatch(view.text(), /Email workspace/);
    await view.click(button);
    assert.match(view.text(), /Email workspace\/email$/);
    assert.equal(storage.data.get('axal:email:messages-moved:11'), '1');
  } finally { await view.unmount(); }
  view = await mountContracts(routes(11, storage), '/messages');
  try { assert.doesNotMatch(view.text(), /Messages is now Email/); assert.match(view.text(), /Email workspace\/email$/); }
  finally { await view.unmount(); }
  view = await mountContracts(routes(22, storage), '/messages');
  try { assert.match(view.text(), /Messages is now Email/); }
  finally { await view.unmount(); }
});

test('a direct Email visit shows the workspace; blocked browser storage never blocks the move', async () => {
  const storage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  let view = await mountContracts(routes(11, storage), '/email');
  try { assert.match(view.text(), /Email workspace/); assert.doesNotMatch(view.text(), /Messages is now Email/); }
  finally { await view.unmount(); }
  view = await mountContracts(routes(11, storage), '/messages');
  try { await view.click('Open Email'); assert.match(view.text(), /Email workspace\/email$/); }
  finally { await view.unmount(); }
});

test('the GP control opens the selected fund in the Email composer and gives help without a GP account', async () => {
  const portal = { lp_holdings: [{ id: 1, fund_id: 1, fund_name: 'Fund One' }, { id: 2, fund_id: 2, fund_name: 'Fund Two' }],
    funds: { 1: { gp: { name: 'GP One', contact_email: 'gp-one@example.invalid' } }, 2: { gp: { name: 'GP Two', contact_email: 'gp-two@example.invalid' } } } };
  const view = await mountContracts(h(EmailGp, { portal }));
  try {
    const email = () => view.nodes().find((n) => n.tagName === 'A' && view.props(n)?.['data-testid'] === 'email-action');
    assert.equal(view.props(email()).href, '/email?person=fund_gp%3A1&compose=1&from=LP+commitment');
    const select = view.nodes().find((n) => n.tagName === 'SELECT');
    const { act } = await import('react');
    await act(async () => view.props(select).onChange({ target: { value: '2' } }));
    assert.equal(view.props(email()).href, '/email?person=fund_gp%3A2&compose=1&from=LP+commitment');
    assert.doesNotMatch(view.text(), /Send|Sent|Messages/);
  } finally { await view.unmount(); }
  const empty = await mountContracts(h(EmailGp, { portal: { lp_holdings: portal.lp_holdings, funds: {} } }));
  try { assert.match(empty.text(), /No general partner/); assert.equal(empty.nodes().some((n) => empty.props(n)?.['data-testid'] === 'email-action'), false); }
  finally { await empty.unmount(); }
  assert.equal(recipientFor({ ref: 'fund_gp:1', kind: 'fund_gp', address: 'gp@example.invalid' }, []), 'gp@example.invalid');
  assert.equal(recipientFor({ ref: 'work_product:1', kind: 'work_product', address: 'client@example.invalid' }, []), 'client@example.invalid');
});

test('the shipped shell and both starters retire the old page and client', () => {
  for (const p of ['src/pages/MessagesPage.jsx', 'src/lib/messagesView.js', '../cloudflare-worker/src/routes/messages.ts']) assert.equal(existsSync(new URL('../' + p, import.meta.url)), false, p);
  assert.doesNotMatch(raw('src/lib/api.js'), /message(?:Threads|Thread|StartThread|Send|MarkRead|Archive|Attach|AttachmentLink)\s*:/);
  assert.match(raw('src/App.jsx'), /path="\/messages"[^\n]*<MessagesRedirect/);
  const delivery = raw('src/pages/advisor/practice/DeliveryZone.jsx');
  assert.match(delivery, /<EmailAction person=\{`work_product:\$\{i.id\}`\}/);
  const walk = (url) => readdirSync(url, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(new URL(d.name + '/', url)) : /\.[jt]sx?$/.test(d.name) ? [new URL(d.name, url)] : []);
  for (const url of walk(new URL('../src/', import.meta.url))) assert.doesNotMatch(readFileSync(url, 'utf8'), /\bapi\.message(?:Threads|Thread|StartThread|Send|MarkRead|Archive|Attach|AttachmentLink)\(/, url.pathname);
});

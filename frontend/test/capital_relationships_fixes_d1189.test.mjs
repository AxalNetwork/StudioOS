/**
 * D1189 (#3123) — Capital relationships part 1, the four page-side fixes:
 *   · Add investor's Fit line says sector focus only (fund size is not read);
 *   · Investor match counts the warm paths its rows show (`warm_path`), not
 *     linked contacts, and each row draws its own warm path;
 *   · the Raise drawer's "Open in Contacts hub" opens that contact, and the
 *     Contacts hub opens the drawer `?contact=` names;
 *   · the rail names Call for Capital (`/raise/call`) and its history
 *     (`/raise/calls`), not a phone call.
 * The fifth fix (the Feedback section's answer) is the Worker's:
 * cloudflare-worker/test/capital_relationships_feedback_d1189.test.ts.
 * Every person and firm here is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { FORMS } from '../src/pages/cycles/forms.js';
import FounderGrowCapitalMatch, { hasWarmPath } from '../src/pages/founder/FounderGrowCapitalMatch.jsx';
import { ContactsPanel } from '../src/pages/ContactsPage.jsx';
import { contactHubPath } from '../src/pages/RaisePipelinePage.jsx';
import { pageFor } from '../src/lib/railPages.js';

const h = React.createElement;

async function withApi(stubs, run) {
  const saved = Object.fromEntries(Object.keys(stubs).map((k) => [k, api[k]]));
  Object.assign(api, stubs);
  try { return await run(); } finally { Object.assign(api, saved); }
}

test('Fit copy: Add investor says Fit reads sector focus only, never fund size', () => {
  const [form] = FORMS.raise['capital-relationships'];
  assert.equal(form.foot, 'Fit is read from their sector focus only.');
  assert.doesNotMatch(form.foot, /fund size/i);
});

test('warm paths: a row has one only when it names who can introduce you', () => {
  assert.equal(hasWarmPath({ warm_path: 'Via Lin Park' }), true);
  assert.equal(hasWarmPath({ warm_path: '   ' }), false);
  assert.equal(hasWarmPath({ warm_path: null, contact_id: 100 }), false, 'a linked contact is not an introduction');
  assert.equal(hasWarmPath({}), false);
});

test('Investor match: the warm-path stat counts the paths the rows draw', async () => {
  const rows = [
    { id: 1, name: 'Northwind Capital', stage: 'contacted', contact_id: 100, warm_path: 'Via Lin Park' },
    { id: 2, name: 'Harbour Angels', stage: 'to_contact', contact_id: 101, warm_path: null },
    { id: 3, name: 'Quinn Ventures', stage: 'meeting', contact_id: null, warm_path: '' },
  ];
  await withApi({
    listProjects: async () => ({ items: [{ id: 7, name: 'Kestrel Labs' }] }),
    raiseProspects: async () => ({ items: rows }),
  }, async () => {
    const view = await mountContracts(h(FounderGrowCapitalMatch, { user: { role: 'founder' } }), '/raise/capital-match?project_id=7');
    try {
      await view.flush(); await view.flush();
      const text = view.text();
      assert.match(text, /With a warm path1Who can introduce you, as recorded/);
      const paths = view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'fg-capital-path').map((n) => view.props(n).children);
      assert.deepEqual(paths, ['Via Lin Park', 'Not recorded', 'Not recorded']);
    } finally { await view.unmount(); }
  });
});

test('Investor match: no named path reads as none, whatever contacts are linked', async () => {
  await withApi({
    listProjects: async () => ({ items: [{ id: 7, name: 'Kestrel Labs' }] }),
    raiseProspects: async () => ({ items: [{ id: 2, name: 'Harbour Angels', stage: 'to_contact', contact_id: 101 }] }),
  }, async () => {
    const view = await mountContracts(h(FounderGrowCapitalMatch, { user: { role: 'founder' } }), '/raise/capital-match?project_id=7');
    try {
      await view.flush(); await view.flush();
      assert.match(view.text(), /With a warm path0No prospect names a warm path yet/);
    } finally { await view.unmount(); }
  });
});

test('Contacts hub door: the drawer links the contact, not the inbox', () => {
  assert.equal(contactHubPath('c100'), '/network?tab=contacts&contact=c100');
  assert.equal(contactHubPath('a b'), '/network?tab=contacts&contact=a%20b');
  assert.equal(contactHubPath(null), '/network?tab=contacts');
  const src = readFileSync(new URL('../src/pages/RaisePipelinePage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Link to=\{contactHubPath\(contact\.uid\)\}/);
  assert.doesNotMatch(src, /<Link to="\/network\?tab=contacts"/);
});

test('Contacts hub: ?contact= opens that contact\'s drawer', async () => {
  const asked = [];
  await withApi({
    contactsList: async () => ({ items: [{ uid: 'c100', name: 'Northwind contact', audience: 'investor', status: 'new' }], counts: {} }),
    contactGet: async (uid) => { asked.push(uid); return { uid, name: 'Northwind contact', email: 'northwind@example.test', audience: 'investor', status: 'new', replies: [], tasks: [] }; },
  }, async () => {
    const view = await mountContracts(h(ContactsPanel), '/network?tab=contacts&contact=c100');
    try {
      await view.flush(); await view.flush();
      assert.deepEqual(asked, ['c100']);
      assert.match(view.text(), /northwind@example\.test/);
    } finally { await view.unmount(); }
    const plain = await mountContracts(h(ContactsPanel), '/network?tab=contacts');
    try { await plain.flush(); await plain.flush(); assert.deepEqual(asked, ['c100'], 'no contact named, no drawer read'); } finally { await plain.unmount(); }
  });
});

test('rail: /raise/call is Call for Capital over Raise, /raise/calls its history', () => {
  const call = pageFor('/raise/call', 'founder');
  const calls = pageFor('/raise/calls', 'founder');
  assert.equal(call.key, 'Founder · Raise');
  assert.match(call.alias, /^Call for Capital opens over Raise’s overview/);
  assert.equal(calls.key, 'Founder · Raise · Capital relationships');
  assert.match(calls.alias, /history of Calls for Capital/);
  for (const p of [call, calls]) assert.doesNotMatch(p.alias, /Log a call|call with an investor/);
});

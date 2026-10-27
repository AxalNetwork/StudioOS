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
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { FORMS } from '../src/pages/cycles/forms.js';
import { ContactsPanel } from '../src/pages/ContactsPage.jsx';
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

// D1194 (#3128): Investor match (FounderGrowCapitalMatch) and the old pipeline's Contacts hub door
// (RaisePipelinePage) are retired into Capital relationships; its Match and Pipeline tabs carry them.

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
      // D1317: the contact opens as the shared right-side Sheet, at its own 480px, named by its title.
      const sheet = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contact-drawer');
      assert.equal(view.props(sheet).role, 'dialog');
      assert.ok(view.props(sheet)['aria-labelledby']);
      assert.equal(view.props(sheet)['data-width'], 480);
      assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'contact-drawer-scrim'));
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

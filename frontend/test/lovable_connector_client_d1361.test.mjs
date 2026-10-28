// D1361: HQ › Integration keys › Lovable connector. The card is Super Admin
// only, its client reads `/admin/connector-clients/lovable`, and the secret is
// only ever drawn from the create reply, never from the read.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectorClientSection, { LOVABLE_CLIENT_NOTE, LOVABLE_SECRET_ONCE } from '../src/pages/admin/consoles/ConnectorClientSection.jsx';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the card renders its note and waits for the read before offering Create', () => {
  const html = renderToStaticMarkup(React.createElement(ConnectorClientSection, { showToast: () => {} }));
  assert.match(html, /Lovable connector/);
  assert.ok(html.includes(LOVABLE_CLIENT_NOTE.slice(0, 40)));
  assert.match(html, /Loading/);
  assert.doesNotMatch(html, /lovable-client-create/, 'no Create before the read answers');
});

test('the client hits the Worker route; the secret is shown from the create reply only, once', () => {
  const client = src('lib/api/connectorClients.js');
  assert.match(client, /request\('\/admin\/connector-clients\/lovable'\)/);
  assert.match(client, /request\('\/admin\/connector-clients\/lovable', \{ method: 'POST'/);
  const card = src('pages/admin/consoles/ConnectorClientSection.jsx');
  assert.match(card, /made\?\.client_secret &&/, 'drawn from `made`, the create reply');
  assert.doesNotMatch(card, /state\?\.client_secret/, 'never from the read');
  assert.match(LOVABLE_SECRET_ONCE, /shown once/);
  const page = src('pages/admin/consoles/IntegrationKeysConsole.jsx');
  assert.match(page, /holdsSecretWrites && <ConnectorClientSection/, 'Super Admin only');
});

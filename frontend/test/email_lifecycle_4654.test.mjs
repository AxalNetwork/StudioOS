// #4654 — the OAuth callback can answer `superseded`: a connection that lost to a newer one, or to a disconnect.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectOutcome } from '../src/pages/email/ConnectPanel.jsx';

const h = React.createElement;
const text = (outcome) => renderToStaticMarkup(h(ConnectOutcome, { outcome })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('superseded is Not connected, says nothing changed and how to go on, and is not drawn as a failure or a success', () => {
  const t = text('superseded');
  // Mutation checked: the entry removed → nothing is drawn for the redirect the Worker now sends.
  assert.match(t, /Not connected/);
  assert.match(t, /This connection was not used/);
  assert.match(t, /nothing changed/i);
  assert.doesNotMatch(t, /could not be connected|Your mailbox is connected/);
});

test('the outcomes the Worker redirects with are all drawn, and an unknown one draws nothing', () => {
  for (const o of ['connected', 'declined', 'expired', 'superseded', 'failed']) assert.ok(text(o).length > 0, o);
  assert.equal(text('mystery'), '');
});

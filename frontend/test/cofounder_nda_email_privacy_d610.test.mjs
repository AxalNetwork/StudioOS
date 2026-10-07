/**
 * D610 (#1310) — Co-founder matching: Connections tab renders notice when
 * the counterparty's email is withheld until both parties sign the NDA.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cofounder_nda_email_privacy_d610.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectionCard } from '../src/pages/CofounderPage.jsx';

const NOTICE_TEXT = 'Shown once you have both signed the NDA';
const CLOSED_NOTICE_TEXT = 'Not shared: you did not both sign the NDA.';

test('ConnectionCard renders withheld notice on pending NDA connection, hides email', () => {
  const pendingConn = {
    uid: 'conn-pending',
    status: 'pending_nda',
    i_signed_at: null,
    they_signed_at: null,
    counterparty: {
      user_id: 101,
      name: 'Bob Candidate',
      email: null,
      email_withheld: 'until_both_sign',
    },
  };

  const html = renderToStaticMarkup(React.createElement(ConnectionCard, { conn: pendingConn }));

  // Assert notice is rendered and email is not rendered
  assert.ok(html.includes(NOTICE_TEXT), 'Withheld notice must be rendered for pending NDA connection');
  assert.ok(!html.includes('@'), 'Email must not be rendered when withheld');
  assert.ok(html.includes('Bob Candidate'), 'Counterparty name must still be rendered');
});

test('ConnectionCard renders email and hides notice on active (both signed) connection', () => {
  const activeConn = {
    uid: 'conn-active',
    status: 'active',
    i_signed_at: '2026-10-06T10:00:00Z',
    they_signed_at: '2026-10-06T11:00:00Z',
    counterparty: {
      user_id: 102,
      name: 'Alice Co-founder',
      email: 'alice@cofounder.test',
    },
  };

  const html = renderToStaticMarkup(React.createElement(ConnectionCard, { conn: activeConn }));

  // Assert email is rendered and notice is not rendered
  assert.ok(html.includes('alice@cofounder.test'), 'Counterparty email must be rendered for active connection');
  assert.ok(!html.includes(NOTICE_TEXT), 'Withheld notice must not be rendered when email is revealed');
  assert.ok(html.includes('Alice Co-founder'), 'Counterparty name must be rendered');
});

test('ConnectionCard renders "Not shared" notice on closed connection without signatures', () => {
  const closedConn = {
    uid: 'conn-closed',
    status: 'closed',
    i_signed_at: null,
    they_signed_at: null,
    counterparty: {
      user_id: 103,
      name: 'Carol Candidate',
      email: null,
      email_withheld: 'until_both_sign',
    },
  };

  const html = renderToStaticMarkup(React.createElement(ConnectionCard, { conn: closedConn }));

  assert.ok(html.includes(CLOSED_NOTICE_TEXT), 'Closed connection must inform that NDA was not signed by both');
  assert.ok(!html.includes(NOTICE_TEXT), 'Must not prompt to sign on a closed connection');
  assert.ok(!html.includes('@'), 'Email must not be rendered');
});

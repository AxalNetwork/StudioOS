/**
 * D610 (#1310) — the Connections tab says why no email is shown: the Worker
 * withholds the other person's email until both have signed the NDA. Rendered,
 * not read from the source, so a line that never draws does not pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionCard } from '../src/pages/CofounderPage.jsx';

const render = (conn) => renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement(ConnectionCard, { conn, onSign: () => {}, onClosed: () => {} })))
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const conn = (status, counterparty, signed = {}) => ({
  uid: `c-${status}`, status, created_at: '2026-10-07', i_signed_at: signed.me ?? null, they_signed_at: signed.them ?? null,
  my_nda_document_id: 1, counterparty: { user_id: 2, name: 'Ben', profile: null, ...counterparty },
});

test('D610: a pending connection says the email shows once both have signed, and shows none', () => {
  const t = render(conn('pending_nda', { email: null, email_withheld: 'until_both_sign' }, { me: '2026-10-07' }));
  assert.match(t, /Ben/);
  assert.match(t, /Email: Shown once you have both signed the NDA/);
  assert.doesNotMatch(t, /@/);
});

test('D610: an active connection shows the email and no withheld line', () => {
  const t = render(conn('active', { email: 'ben@example.test' }, { me: '2026-10-07', them: '2026-10-07' }));
  assert.match(t, /\( ?ben@example\.test ?\)/);
  assert.doesNotMatch(t, /Shown once you have both signed|not shared/);
});

test('D610: a connection closed before both signed says the email was not shared', () => {
  const t = render(conn('closed', { email: null, email_withheld: 'until_both_sign' }));
  assert.match(t, /Email not shared: you did not both sign the NDA/);
  assert.doesNotMatch(t, /Shown once you have both signed/);
});

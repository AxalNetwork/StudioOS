/**
 * D884 (#2557) PR 2 — an investor's Mercury words name the sign-in, never a
 * token (D881): the proof-of-funds connect line, and what disconnecting keeps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECT_FIRST, CONNECTORS_LINK } from '../src/pages/investor/proofOfFundsModel.js';
import { memberDisconnectNote } from '../src/pages/account/mercuryModel.js';

test('proof of funds asks the investor to sign in with Mercury, on the Mercury page', () => {
  // Mutation checked: the token sentence put back → both the match and the token check fail.
  assert.match(CONNECT_FIRST, /sign in with Mercury, read-only/);
  assert.doesNotMatch(CONNECT_FIRST, /token/i);
  assert.equal(CONNECTORS_LINK.href, '/account/connectors/mercury');
});

test('an investor\'s disconnect keeps the shared statements and what they accepted, and revokes the sign-in', () => {
  // Mutation checked: the old token note → the sign-in match fails.
  const note = memberDisconnectNote('investor');
  assert.match(note, /does not revoke them/);
  assert.match(note, /Capacity, proposals and entries you accepted stay\. Your Mercury sign-in is revoked\.$/);
  assert.doesNotMatch(note, /token/i);
});

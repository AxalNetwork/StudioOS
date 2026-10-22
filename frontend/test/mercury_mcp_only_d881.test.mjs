/**
 * D881 (#2554) — a member's Mercury connects only by Sign in with Mercury.
 *
 *  - The page model offers no token: no other way in, no Replace, and a token
 *    row kept from before D881 is offered the sign-in.
 *  - The Worker's sign-in kind `mcp` draws its Sign-in URL and has words in
 *    Discover's filter.
 *  - The member words name no token; HQ's entity words keep theirs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_mcp_only_d881.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyDetailsRows, manageItems, pageAction, pageChoices, signInLabel } from '../src/pages/account/connectorPageModel.js';
import { SIGN_IN_LABEL } from '../src/pages/account/discoverModel.js';
import * as mercury from '../src/pages/account/mercuryModel.js';

const member = (connection = null) => ({ key: 'mercury', display_name: 'Mercury', auth_type: 'api_key', status: 'beta', tier: 'growth', available: true, has_implementation: true, connection_source: 'integrations', connection });
const PAGE = {
  made_by: { name: 'Axal VC' }, service: { name: 'Mercury' }, category: 'Accounting and banking', added: '2026-10',
  sign_in: { kind: 'mcp', label: 'Sign in with Mercury', key_help_href: null },
  endpoints: { sign_in: 'https://mcp.mercury.com/mcp', api: 'https://api.mercury.com/api/v1' }, links: {},
};

test('the page model offers a member no token, and a token row kept from before D881 the sign-in', () => {
  assert.deepEqual(pageChoices(member()).alt, []);
  assert.equal(signInLabel(member()), 'Sign in with Mercury');
  assert.deepEqual(pageAction(member()).kind, 'oauth');
  const token = member({ uid: 'u-m', provider_key: 'mercury', status: 'active', auth_type: 'api_key' });
  assert.deepEqual(manageItems(token).map((i) => i.id), ['sync', 'reconnect', 'disconnect']);
  assert.equal(manageItems(token).find((i) => i.id === 'reconnect').label, 'Sign in with Mercury');
  assert.ok(!manageItems(token).some((i) => i.id === 'replace'), 'no token to replace');
});

test('the mcp sign-in kind draws its Sign-in URL, and Discover has words for it', () => {
  const rows = bodyDetailsRows(PAGE, member());
  assert.deepEqual(rows.find((r) => r.label === 'Sign-in URL')?.value, 'https://mcp.mercury.com/mcp');
  assert.equal(rows.find((r) => r.label === 'Sign-in').value, 'Sign in with Mercury');
  assert.equal(SIGN_IN_LABEL.mcp, 'Sign in through the service’s MCP server');
});

test('member words name no token; HQ\'s entity token words stay', () => {
  assert.equal(mercury.TOKEN_ALT, undefined, 'the "Use a Read Only API token" choice is gone');
  for (const words of [mercury.MEMBER_REPLACE, ...Object.values(mercury.SIGN_IN_REASONS), mercury.personalToolBanner('unauthorized')]) {
    assert.doesNotMatch(words, /Read Only API token|replace the token|Replace its token/, words);
  }
  assert.equal(mercury.VIA_ROWS.api_key, 'Connected with an API token. Sign in with Mercury to keep it connected after you reconnect.');
  // The Worker says the same sentence on /status.
  const worker = readFileSync('cloudflare-worker/src/integrations/providers/mercury.ts', 'utf8');
  assert.ok(worker.includes(`LEGACY_TOKEN_NOTICE = '${mercury.LEGACY_TOKEN_NOTICE}'`), 'one sentence, the Worker\'s');
  // HQ's entity form (C2 moves it) keeps its token help and its confirm label.
  assert.equal(mercury.TOKEN_HELP, 'How to create a Read Only token');
  assert.equal(mercury.confirmReadOnlyLabel('Axal VC GP LLC'), 'This is a Read Only token from Axal VC GP LLC\'s Mercury organization.');
  // The member flow sends no read-only confirmation of its own.
  assert.doesNotMatch(readFileSync('frontend/src/pages/account/useConnectFlow.js', 'utf8'), /confirm_read_only|confirmReadOnly/);
});

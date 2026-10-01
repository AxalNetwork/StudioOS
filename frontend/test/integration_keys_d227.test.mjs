/**
 * D227 on the page: Integration keys offers rotate and remove wherever a key
 * lives, reads an unanswered table as Unknown rather than offering Configure,
 * never prints an unread count as 0, and its save dialog says what a save does.
 *
 * `lib/integrationKeys.js` is pure, so every state goes through it here. The
 * panel loads in effects, so that it USES the module — and no longer gates on
 * `source === 'db'` — is read as source, bounded to the panel and its dialog.
 * What the worker returns in each state is pinned by
 * cloudflare-worker/test/integration_keys_d227.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  KEY_STATES, keyActionsFor, keyStateBadge, connectedUsersLine, removeConfirmText, SAVE_EFFECT,
} from '../src/lib/integrationKeys.js';

const PAGE = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8'));
function block(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is gone from AdminPage.jsx`);
  const next = PAGE.indexOf('\nfunction ', at + 1);
  return PAGE.slice(at, next > at ? next : PAGE.length);
}
const PANEL = block('IntegrationKeysPanel');
const MODAL = block('IntegrationKeysEditModal');

test('rotate and remove follow the key wherever it lives', () => {
  for (const s of ['env', 'db']) {
    assert.deepEqual(keyActionsFor(s), { configure: false, rotate: true, remove: true }, `${s} lost an action`);
  }
  assert.deepEqual(keyActionsFor('unset'), { configure: true, rotate: false, remove: false });
});

test('an unknown key offers nothing — least of all Configure', () => {
  for (const s of ['unreadable', undefined, null, 'unconfigured', 'something-new']) {
    assert.deepEqual(keyActionsFor(s), { configure: false, rotate: false, remove: false }, `${String(s)} offered an action`);
  }
  assert.equal(keyStateBadge('unreadable').text, 'unknown');
  assert.notEqual(keyStateBadge('unreadable').text, keyStateBadge('unset').text, 'unknown reads the same as not configured');
  assert.deepEqual(KEY_STATES, ['env', 'db', 'unset', 'unreadable'], 'a state was added here and not to the worker');
});

test('an unread count never renders as zero, least of all in the Remove confirmation', () => {
  assert.match(connectedUsersLine(null), /unknown/);
  assert.doesNotMatch(connectedUsersLine(null), /\b0\b/);
  assert.equal(connectedUsersLine(0), '0 active user integrations');
  assert.equal(connectedUsersLine(1), '1 active user integration');
  const unread = removeConfirmText('Slack', null);
  assert.match(unread, /could not be read/);
  assert.doesNotMatch(unread, /\b0\b|No user integration/, 'an unread count promised no disconnections');
  assert.match(removeConfirmText('Slack', 3), /disconnects 3 active user integrations/);
  assert.match(removeConfirmText('Slack', 0), /No user integration is active/);
});

test('the save dialog says what a save does now', () => {
  for (const [mode, text] of Object.entries(SAVE_EFFECT)) {
    assert.match(text, /Worker secret/, `${mode}: the destination is not named`);
    assert.doesNotMatch(text, /hash/i, `${mode}: it still claims a hash is logged`);
    assert.doesNotMatch(text, /advis|advice|recommend|fiduciar/i);
  }
  assert.match(SAVE_EFFECT.configure, /removes any copy kept in the database/);
  assert.match(MODAL, /isRotate \? SAVE_EFFECT\.rotate : SAVE_EFFECT\.configure/);
  assert.doesNotMatch(MODAL, /Only the secret hash is ever logged/);
});

test('the panel reads the worker\'s state, not source === db', () => {
  assert.match(PANEL, /const actions = keyActionsFor\(state\);/);
  assert.match(PANEL, /const state = row\.state;/);
  assert.doesNotMatch(PANEL, /row\.source === 'db'/, 'an action is still gated on the database store');
  assert.doesNotMatch(PANEL, /wrangler secret delete/, 'Remove still refuses a key held as a Worker secret');
  assert.match(PANEL, /holdsSecretWrites && actions\.configure && \(/);
  assert.match(PANEL, /holdsSecretWrites && actions\.rotate && \(/);
  assert.match(PANEL, /holdsSecretWrites && actions\.remove && \(/);
  assert.match(PANEL, /removeConfirmText\(/);
  assert.match(PANEL, /connectedUsersLine\(row\.active_integrations\)/);
});

test('an unreadable key reads Unknown, with the reason the worker gave', () => {
  assert.match(PANEL, /r\.db_readable === false/);
  assert.match(PANEL, /state === 'unreadable' && \(/);
  assert.match(PANEL, /<Unrecorded reason=\{unreadableReason/);
  assert.match(PANEL, />Unknown<\/Unrecorded>/);
});

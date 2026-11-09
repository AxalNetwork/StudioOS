/**
 * D4616 (#4616) — the Settings sessions card and the Display name field. The
 * Worker's half is cloudflare-worker/test/settings_sessions_identity_4616.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/settings_sessions_identity_4616.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionRowState } from '../src/lib/sessionRows.js';
import { effectiveDisplayName } from '../src/lib/displayName.js';

const page = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');

test('a session row is drawn from its status: only an active one offers Revoke; history says why it ended', () => {
  // Mutation checked: an expired or signed-out row drawn as a live device.
  assert.deepEqual(sessionRowState({ status: 'active' }), { status: 'active', live: true, label: null });
  assert.equal(sessionRowState({ status: 'expired' }).label, 'Expired');
  assert.equal(sessionRowState({ status: 'signed_out' }).label, 'Signed out');
  assert.equal(sessionRowState({ status: 'revoked' }).label, 'Revoked');
  assert.equal(sessionRowState({ status: 'expired' }).live, false);
  assert.equal(sessionRowState({ revoked_at: '2026-11-01' }).label, 'Revoked', 'an older Worker without status still reads revoked_at');
  assert.equal(sessionRowState({}).live, true);
});

test('the card uses the row state; the current-device warning and logout are kept', () => {
  assert.match(page, /const row = sessionRowState\(s\);/);
  assert.match(page, /\{!row\.live \? \(/);
  assert.doesNotMatch(page, /const isRevoked = !!s\.revoked_at;/);
  assert.match(page, /if \(sess\.is_current && !window\.confirm\(/, 'revoking this device still warns first');
  assert.match(page, /if \(sess\.is_current\) \{[\s\S]{0,120}window\.location\.href = '\/login'/, 'and still signs out after');
  assert.match(page, /This device/);
});

test('Display name edits the identity display_name, never the account name; the preview uses the public rule', () => {
  // Mutation checked: the field writing `patch({ name })` again.
  const section = page.slice(page.indexOf('function ProfileSection('), page.indexOf('function ProfileBackgroundSection'));
  assert.ok(section.length > 500);
  assert.match(section, /api\.updateIdentitySettings\(\{ display_name: next \|\| null \}\)/);
  assert.doesNotMatch(section, /patch\(\{ name \}\)/);
  assert.match(section, /const name = effectiveDisplayName\(displayName, data\.name\)/);
  assert.match(section, /<AuthorCard[\s\S]{0,80}name,/);
  assert.equal(effectiveDisplayName('  Mel M. ', 'Mel Member'), 'Mel M.');
  assert.equal(effectiveDisplayName('', 'Mel Member'), 'Mel Member', 'unset falls back to the account name, as the public profile does');
  assert.equal(effectiveDisplayName(null, ''), null);
});

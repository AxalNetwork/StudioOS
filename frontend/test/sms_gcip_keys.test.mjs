/**
 * SMS backup factor: a Super Admin can provision GCIP from Integration keys.
 * The Settings card points there instead of a wrangler-only secret, and only
 * a Super Admin gets the link (the owner's ruling, 2026-10-20).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminConsoleSource } from './_adminConsoles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('Admin Integration Keys lists Google Identity (SMS)', () => {
  const src = adminConsoleSource();
  assert.match(src, /gcip:\s*'Google Identity \(SMS\)'/);
  assert.match(src, /gcip:\s*\['GCIP_PROJECT_ID',\s*'GCIP_API_KEY'\]/);
});

test('Settings SMS unavailable card links the Super Admin to Integration keys', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/SettingsPage.jsx'), 'utf8');
  assert.match(src, /data-testid="sms-admin-keys-link"/);
  assert.match(src, /href="\/admin\/integration-keys"/);
  assert.match(src, /\{isSuperAdmin && \(\s*<a\s+href="\/admin\/integration-keys"/, 'a plain admin gets no link to a page they cannot open');
  assert.match(src, /Google Identity \(SMS\)/);
});

test('worker treats gcip as a managed provider key', () => {
  const src = readFileSync(resolve(root, 'cloudflare-worker/src/services/providerOauthKeys.ts'), 'utf8');
  assert.match(src, /\|\s*'gcip'/);
  assert.match(src, /gcip:\s*\{\s*id:\s*'GCIP_PROJECT_ID'/);
});

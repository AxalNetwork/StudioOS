/**
 * SMS backup factor: admin can provision GCIP from Integration Keys.
 * The Settings card points there instead of a wrangler-only secret.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('Admin Integration Keys lists Google Identity (SMS)', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/AdminPage.jsx'), 'utf8');
  assert.match(src, /gcip:\s*'Google Identity \(SMS\)'/);
  assert.match(src, /gcip:\s*\['GCIP_PROJECT_ID',\s*'GCIP_API_KEY'\]/);
});

test('Settings SMS unavailable card links admins to Integration Keys', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/SettingsPage.jsx'), 'utf8');
  assert.match(src, /data-testid="sms-admin-keys-link"/);
  assert.match(src, /\/admin\?tab=integration-keys/);
  assert.match(src, /Google Identity \(SMS\)/);
});

test('worker treats gcip as a managed provider key', () => {
  const src = readFileSync(resolve(root, 'cloudflare-worker/src/services/providerOauthKeys.ts'), 'utf8');
  assert.match(src, /\|\s*'gcip'/);
  assert.match(src, /gcip:\s*\{\s*id:\s*'GCIP_PROJECT_ID'/);
});

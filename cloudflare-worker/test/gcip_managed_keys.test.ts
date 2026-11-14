/**
 * SMS backup 2FA is gated on GCIP_API_KEY. That key is now a managed
 * Integration Keys provider (`gcip`) so an admin can enable Settings →
 * Security → SMS without a wrangler secret put.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MANAGED_PROVIDERS, PROVIDER_ENV_VARS } from '../src/services/providerOauthKeys.ts';

test('gcip is a managed Integration Keys provider for SMS', () => {
  assert.ok(MANAGED_PROVIDERS.includes('gcip'));
  assert.deepEqual(PROVIDER_ENV_VARS.gcip, {
    id: 'GCIP_PROJECT_ID',
    secret: 'GCIP_API_KEY',
  });
});

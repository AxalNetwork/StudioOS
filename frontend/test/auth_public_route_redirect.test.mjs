import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicPath } from '../src/lib/api.js';

test('directory-style public auth routes never trigger a session-expiry redirect', () => {
  for (const path of ['/login/', '/register/', '/verify-email/', '/spinout-lab/']) {
    assert.equal(isPublicPath(path), true, `${path} must be handled as public`);
  }
});

test('protected routes still require an active session', () => {
  assert.equal(isPublicPath('/studio/'), false);
  assert.equal(isPublicPath('/spinout-lab/apply/'), false);
});
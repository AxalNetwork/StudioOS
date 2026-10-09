import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const login = codeOnly(readFileSync(resolve('frontend/src/pages/LoginPage.jsx'), 'utf8'));

test('login startup leaves WebAuthn untouched until passkey sign-in is chosen', () => {
  assert.doesNotMatch(login, /^import .*@simplewebauthn\/browser/m,
    'the passkey browser module must not load with the sign-in form');
  const handlerAt = login.indexOf('const signInWithPasskey = async');
  const handlerEnd = login.indexOf('\n  };', handlerAt);
  assert.ok(handlerAt >= 0 && handlerEnd > handlerAt, 'passkey handler is missing');
  const startup = login.slice(0, handlerAt);
  const handler = login.slice(handlerAt, handlerEnd);
  assert.doesNotMatch(startup, /browserSupportsWebAuthn\s*\(/,
    'rendering sign-in must not call the native WebAuthn capability probe');
  assert.match(handler, /import\('@simplewebauthn\/browser'\)/,
    'passkey sign-in must load the browser library on demand');
  assert.match(handler, /browserSupportsWebAuthn\s*\(/,
    'the passkey handler must still check support before authenticating');
  assert.match(handler, /startAuthentication\s*\(/,
    'the passkey handler must still run the existing authentication flow');
});

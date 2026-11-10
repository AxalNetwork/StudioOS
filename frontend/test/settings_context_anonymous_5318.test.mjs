/**
 * #5318 H10 (D5318): an anonymous page does not send the two member-only
 * settings reads (`/api/settings/appearance`, `/api/settings/explainers`),
 * which can only answer 401 to a visitor. Before H10 SettingsProvider sent both
 * on every load of every page; the Worker side is
 * cloudflare-worker/test/public_config_cache_5318.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { mayHaveSession } from '../src/lib/sessionHint.js';

const store = (entries) => ({ getItem: (k) => (k in entries ? entries[k] : null) });

test('mayHaveSession: no token, no user and no CSRF cookie is a visitor', () => {
  assert.equal(mayHaveSession({ storage: store({}), cookie: '', hostname: 'axal.vc' }), false);
  assert.equal(mayHaveSession({ storage: store({}), cookie: 'other=1; theme=dark', hostname: 'axal.vc' }), false);
  assert.equal(mayHaveSession({ storage: store({}), cookie: 'studioos_csrf=', hostname: 'axal.vc' }), false);
});

test('mayHaveSession: any sign of a session means ask', () => {
  // Mutation checked: dropping the cookie test → the cookie sign-in cases fail.
  assert.equal(mayHaveSession({ storage: store({ token: 'jwt' }), cookie: '', hostname: 'axal.vc' }), true);
  assert.equal(mayHaveSession({ storage: store({ user: '{"id":2}' }), cookie: '', hostname: 'axal.vc' }), true);
  assert.equal(mayHaveSession({ storage: store({}), cookie: 'a=1; studioos_csrf=abc', hostname: 'app.axal.vc' }), true);
  // A branch host reads its own cookie name, never HQ's.
  assert.equal(mayHaveSession({ storage: store({}), cookie: 'studioos_csrf_fr=abc', hostname: 'fr.axal.vc' }), true);
  assert.equal(mayHaveSession({ storage: store({}), cookie: 'studioos_csrf=abc', hostname: 'fr.axal.vc' }), false);
  // Storage that throws cannot be read, so it asks.
  assert.equal(mayHaveSession({ storage: { getItem() { throw new Error('denied'); } }, cookie: '', hostname: 'axal.vc' }), true);
});

test('SettingsProvider checks for a session before both member reads', () => {
  // Mutation checked: the guard removed from refresh() → this fails.
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/contexts/SettingsContext.jsx'), 'utf8'));
  const guard = src.indexOf('if (!pageMayHaveSession())');
  assert.ok(guard > 0, 'refresh() must return early with no sign of a session');
  for (const call of ['api.getAppearanceSettings()', 'api.getExplainersDismissed()']) {
    const at = src.indexOf(call);
    assert.ok(at > guard, `${call} must come after the session check`);
  }
});

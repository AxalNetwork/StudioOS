// D1434 (#3703): auto-reload is a money setting, so its read asks for an
// authenticator and a recent confirmation. Those 403s are a sign-in step, not a
// failed read: Usage and Billing say what to do instead of "could not be read".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTO_RELOAD_GATE, gateLine } from '../src/pages/account/autoReloadModel.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('a step-up refusal asks for the authenticator; a missing authenticator says to add one', () => {
  // Mutation checked: return null for step_up_required → the card says "could not be read" again.
  assert.equal(gateLine({ status: 'unreadable', httpStatus: 403, code: 'step_up_required', message: '' }), AUTO_RELOAD_GATE.confirm);
  assert.equal(gateLine({ status: 'unreadable', httpStatus: 403, code: null, message: 'TOTP required' }), AUTO_RELOAD_GATE.totp);
});

test('anything else is still a failed read, and a good read is never gated', () => {
  assert.equal(gateLine({ status: 'unreadable', httpStatus: 503, code: 'ai_auto_reload_unreadable', message: 'Unreadable' }), null);
  assert.equal(gateLine({ status: 'unreadable', httpStatus: 403, code: 'forbidden', message: 'Forbidden' }), null, 'another 403 is not the sign-in step');
  assert.equal(gateLine({ status: 'ready', data: { enabled: false } }), null);
  assert.equal(gateLine({ status: 'loading' }), null);
  assert.equal(gateLine(null), null);
});

test('both auto-reload cards draw the step, with a Confirm that reads again', () => {
  const overview = src('pages/account/UsageOverview.jsx');
  assert.match(overview, /gateLine\(autoReload\) \?/);
  assert.match(overview, /data-testid="overview-auto-reload-gate"/);
  const card = src('pages/account/AutoReloadCard.jsx');
  assert.match(card, /read\.status !== 'ready' && gateLine\(read\) \?/);
  assert.match(card, /onClick=\{read\.reload\}>Confirm</);
});

/**
 * D223 on the page: a control that writes a Worker secret is drawn only for the
 * Super Admin, and everyone else is told who can make the change.
 *
 * WHAT IS RENDERED AND WHAT IS READ. `SecretWriteGate` is pure over its props,
 * so both halves are RENDERED. The three panels live in AdminPage.jsx and load
 * in effects, so where the gate sits in them is read as source — each
 * secret-writing handler, bounded to its own panel, must be reachable only
 * through the gate or a `holdsSecretWrites &&` guard.
 *
 * The server refuses these writes whatever the page draws
 * (cloudflare-worker/test/secret_consoles_d223.test.ts); this file pins that
 * the page does not offer a button the server can only refuse (D134).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import SecretWriteGate from '../src/components/SecretWriteGate.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/AdminPage.jsx'));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const gate = (holds) => renderToStaticMarkup(React.createElement(
  SecretWriteGate,
  { holds, what: 'Saving the keys', testid: 'gate-note' },
  React.createElement('button', { 'data-testid': 'the-write' }, 'Save'),
));

test('the holder gets the control and no note', () => {
  const html = gate(true);
  assert.match(html, /data-testid="the-write"/);
  assert.doesNotMatch(html, /gate-note/);
});

test('anyone else gets who can make the change, and no control', () => {
  const html = gate(false);
  assert.doesNotMatch(html, /data-testid="the-write"/, 'a non-holder was drawn a write the server refuses');
  assert.match(html, /data-testid="gate-note"/);
  const t = text(html);
  assert.match(t, /Saving the keys writes a secret onto the production Worker/);
  assert.match(t, /only the Super Admin can do it/);
  assert.match(t, /fresh TOTP step-up/);
  // House voice: the page never says advisor, advice, recommendation or fiduciary.
  assert.doesNotMatch(t, /advis|advice|recommend|fiduciar/i);
});

/** A panel's own source, from its declaration to the next top-level function. */
function panel(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is gone from AdminPage.jsx`);
  const next = PAGE.indexOf('\nfunction ', at + 1);
  return PAGE.slice(at, next > at ? next : PAGE.length);
}

/**
 * True when the write at `i` can only render for the holder: it sits inside an
 * open `<SecretWriteGate holds={holdsSecretWrites}` element, or the nearest
 * JSX guard above it on the same element is `holdsSecretWrites &&`.
 */
function gated(src, i) {
  const open = src.lastIndexOf('<SecretWriteGate holds={holdsSecretWrites}', i);
  if (open >= 0 && src.lastIndexOf('</SecretWriteGate>', i) < open) return true;
  const guard = src.lastIndexOf('holdsSecretWrites &&', i);
  // `!holdsSecretWrites &&` is the opposite guard: it draws for everyone ELSE.
  if (guard < 0 || src[guard - 1] === '!') return false;
  // The guard must open THIS element: no other element closes between the guard and the write.
  const between = src.slice(guard, i);
  return !/<\/button>|\)\}/.test(between);
}

const WRITES = [
  ['IntegrationKeysPanel', ['onClick={() => setEditing(', 'onClick={() => onDelete(']],
  ['GithubSyncPanel', ['onClick={onSave}', 'onClick={onRotateSecret}', 'value={token}']],
  ['PaymentsPanel', ['onClick={registerWebhook}']],
];

for (const [name, needles] of WRITES) {
  test(`${name}: every secret-writing control is behind the holder check`, () => {
    const src = panel(name);
    assert.match(src, /const holdsSecretWrites = isSuperAdminUser\(useAuth\(\)\.user\);/,
      `${name} does not read the elevation the server gates on`);
    for (const needle of needles) {
      let from = 0;
      let seen = 0;
      for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, from)) {
        seen += 1;
        assert.ok(gated(src, i), `${name}: \`${needle}\` (occurrence ${seen}) is drawn for every admin`);
        from = i + needle.length;
      }
      assert.ok(seen > 0, `${name}: \`${needle}\` is gone — this check would pass on nothing`);
    }
  });
}

test('what stays open is still drawn for every admin: the probes and the events repair', () => {
  // The server keeps these requireAdmin; hiding them would be the opposite mistake.
  const gh = panel('GithubSyncPanel');
  assert.ok(!gated(gh, gh.indexOf('onClick={() => onTest(false)}')), 'the read test was hidden');
  assert.ok(!gated(gh, gh.indexOf('onClick={() => onTest(true)}')), 'the write probe was hidden');
  const keys = panel('IntegrationKeysPanel');
  assert.ok(!gated(keys, keys.indexOf('onClick={() => onTest(row.provider_key)}')), 'the key test was hidden');
  const pay = panel('PaymentsPanel');
  assert.ok(!gated(pay, pay.indexOf('onClick={() => updateWebhookEvents(ep.id)}')), 'the events repair was hidden');
});

test('the GitHub panel says whether a token is set, and nothing else about it', () => {
  assert.doesNotMatch(PAGE, /token_preview/, 'AdminPage still reads token_preview');
});

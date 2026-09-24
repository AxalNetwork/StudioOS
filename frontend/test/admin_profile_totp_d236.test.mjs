/**
 * D236 — the account drawer's authenticator line says what sign-in says, and a
 * read that failed is not "No".
 *
 * WHAT WAS WRONG. The drawer's KYC tab rendered
 *   <Field label="TOTP enabled" value={kyc.totp_enabled ? 'Yes (required at login)' : 'No'} />
 * over a payload whose `totp_enabled` was the literal `false` for every account
 * — so HQ read "No" about accounts that DO have an authenticator. And the "Yes"
 * branch it could never reach claimed more than is true: a magic link signs an
 * enrolled account in at a lower assurance, so the factor is not "required at
 * login" on every route in.
 *
 * WHAT THIS PINS. `TotpEnrolmentField` is pure over one prop, so its states are
 * RENDERED, not matched:
 *   - `true`  → an answer: enrolled;
 *   - `false` → an answer: not enrolled;
 *   - `null`  → the read failed: Unreadable, carrying the server's own reason;
 *   - absent  → the payload said nothing: Unreadable, with the page's reason;
 *   - any other value (0, 1, 'false', 'true') → not an answer either. A
 *     truthiness test would print "No" for 0 and "Yes" for 'false', which is the
 *     defect this replaced wearing a different value.
 * The drawer itself loads in an effect that static rendering never runs, so the
 * mount is held as source: the KYC tab renders this component and nothing else
 * decides the line.
 *
 * Pinned elsewhere and not repeated here: the worker half — the route reading
 * `hasTotpConfigured`, the legacy base32 case, and the unreadable store — in
 * cloudflare-worker/test/admin_profile_totp_d236.test.ts.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_profile_totp_d236.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { TotpEnrolmentField } from '../src/pages/AdminPage.jsx';

const ADMIN = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8'));

const render = (kyc) => renderToStaticMarkup(React.createElement(TotpEnrolmentField, { kyc }));

const YES = 'Yes — an authenticator app is enrolled';
const NO = 'No — no authenticator app is enrolled';
const ALERT = 'role="alert"';
/** The worker's reason, as `admin.ts` writes it. React writes the quotes as `&quot;`. */
const stem = 'Whether an authenticator is enrolled is unknown, which is not the same as ';
const SERVER_REASON = `${stem}"No".`;
const SERVER_REASON_HTML = `${stem}&quot;No&quot;.`;

test('D236: an enrolled account reads as enrolled, and as nothing else', () => {
  const html = render({ totp_enabled: true, totp_reason: null });
  assert.ok(html.includes('TOTP enabled'), 'the line lost its label');
  assert.ok(html.includes(YES), `an enrolled account did not read as enrolled: ${html}`);
  assert.ok(!html.includes(NO), 'an enrolled account also read as not enrolled');
  assert.ok(!html.includes(ALERT), 'an answer was drawn as a failed read');
});

test('D236: an account with no authenticator reads as a measured No', () => {
  const html = render({ totp_enabled: false, totp_reason: null });
  assert.ok(html.includes(NO), `a measured No did not read as No: ${html}`);
  assert.ok(!html.includes(YES));
  assert.ok(!html.includes(ALERT), 'a measured No was drawn as a failed read');
});

test('D236: a failed read is Unreadable with the server\'s reason — never "No"', () => {
  const html = render({ totp_enabled: null, totp_reason: SERVER_REASON });
  assert.ok(html.includes(ALERT), `a failed read was not drawn as one: ${html}`);
  assert.ok(html.includes('Authenticator enrolment could not be read.'),
    'the failed read does not say what could not be read');
  assert.ok(html.includes(SERVER_REASON_HTML),
    'the server\'s reason did not reach the drawer — the page replaced it with its own');
  assert.ok(!html.includes(NO), 'a failed read printed "No" — the defect this replaced');
  assert.ok(!html.includes(YES), 'a failed read printed "Yes"');
});

test('D236: a payload that says nothing is Unreadable too, with the page\'s own reason', () => {
  for (const kyc of [{}, undefined, null]) {
    const html = render(kyc);
    assert.ok(html.includes(ALERT), `a silent payload (${JSON.stringify(kyc)}) was not drawn as unread`);
    assert.ok(html.includes('The profile did not say whether an authenticator is enrolled.'),
      `a silent payload (${JSON.stringify(kyc)}) carried no reason`);
    assert.ok(!html.includes(NO) && !html.includes(YES),
      `a silent payload (${JSON.stringify(kyc)}) was answered anyway`);
  }
});

test('D236: only the two booleans are answers — a truthy or falsy stand-in is not', () => {
  // The line reads `=== true` and `=== false`. A truthiness test would turn a
  // 0 into "No" and a 'false' string into "Yes", which is the placeholder's
  // defect with a different value in it.
  for (const value of [0, 1, '', 'false', 'true', 'yes']) {
    const html = render({ totp_enabled: value, totp_reason: null });
    assert.ok(html.includes(ALERT), `totp_enabled=${JSON.stringify(value)} was treated as an answer`);
    assert.ok(!html.includes(NO) && !html.includes(YES),
      `totp_enabled=${JSON.stringify(value)} printed an answer it does not carry`);
  }
});

test('D236: the drawer\'s KYC tab draws the line through this component and nothing else', () => {
  const at = ADMIN.indexOf("{data && tab === 'kyc' && (");
  const end = ADMIN.indexOf("{data && tab === 'activity' && (", at);
  assert.ok(at > 0 && end > at, 'the drawer\'s KYC tab moved; re-bound this slice');
  const kycTab = ADMIN.slice(at, end);
  assert.match(kycTab, /<TotpEnrolmentField kyc=\{kyc\} \/>/,
    'the KYC tab no longer mounts TotpEnrolmentField');
  assert.doesNotMatch(kycTab, /totp_enabled/,
    'the KYC tab reads totp_enabled itself again, beside the component that owns it');
});

test('D236: no code in the page claims the factor is required at login', () => {
  // The component's own comment explains why the claim was dropped and quotes
  // it; codeOnly removes comments, so this reads only code and copy.
  assert.ok(!ADMIN.includes('required at login'),
    'the "(required at login)" claim is back — a magic link signs an enrolled account in without it');
});

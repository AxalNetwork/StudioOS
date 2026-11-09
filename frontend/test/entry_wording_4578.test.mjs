/**
 * #4578 (D4578) — the entry journey says what each action does. Creating an account is free and immediate; membership
 * is a later, reviewed step (an admin review and a signed membership agreement), and that is what opens a workspace,
 * Grow included. A new account's email link finishes creating the account; it is not a returning member's sign-in.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/entry_wording_4578.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LANE_COPY, LANES, MEMBERSHIP_STEPS, REGISTER_ACTIONS, registerHeading } from '../src/lib/registerCopy.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('no lane promises "Free to join": each says creating an account is free and that membership is reviewed', () => {
  for (const lane of LANES) {
    const { desc } = registerHeading(lane, null);
    assert.doesNotMatch(desc, /Free to join/, lane);
    assert.match(desc, /Creating an account is free/, lane);
    assert.match(desc, /review|confirmed/, `${lane} names the step after the account`);
  }
  assert.doesNotMatch(registerHeading(null, null).desc, /Free to join/);
  assert.match(LANE_COPY.founder.desc, /Grow/, 'the founder lane says Grow is part of what opens after review');
  assert.match(LANE_COPY.founder.desc, /membership agreement/);
});

test('the steps after the page are named, with no timing promise', () => {
  assert.match(MEMBERSHIP_STEPS, /account is created as soon as you confirm your email/);
  assert.match(MEMBERSHIP_STEPS, /reviews your membership/);
  assert.match(MEMBERSHIP_STEPS, /membership agreement/);
  assert.doesNotMatch(MEMBERSHIP_STEPS, /\b(hour|minute|day|week)s?\b/i, 'no review time is invented');
});

test('the new-account email actions are not sign-in wording; a returning address is told it already has an account', () => {
  for (const k of ['submit', 'sentSignup', 'resendSignup']) assert.doesNotMatch(REGISTER_ACTIONS[k], /sign[ -]?in/i, k);
  assert.match(REGISTER_ACTIONS.submit, /create my account/);
  assert.match(REGISTER_ACTIONS.sentSignin, /already has an account/);
  assert.match(REGISTER_ACTIONS.sentSignin, /sign-in link/);
});

test('the register page asks for the new-account link, and keeps the sign-in link only for an address that already has one', () => {
  const page = src('pages/RegisterPage.jsx');
  // Mutation checked: dropping `purpose = 'signin'` from the 409 branch fails this.
  assert.match(page, /if \(e\?\.code !== 'email_already_registered'\) throw e;\s*purpose = 'signin';/);
  assert.match(page, /await api\.magicStart\(form\.email\.trim\(\), \{ purpose \}\);/);
  assert.match(page, /api\.magicStart\(form\.email\.trim\(\), \{ purpose: linkPurpose \}\)/, 'Resend asks for the same email again');
  assert.match(page, /REGISTER_ACTIONS\.submit/);
  assert.match(page, /data-testid="register-membership-steps">\{MEMBERSHIP_STEPS\}/);
  assert.doesNotMatch(page, /'Email me a sign-in link'/);
});

test('magicStart sends `purpose` only for a new account', async () => {
  const bodies = [];
  const prev = globalThis.fetch;
  const store = new Map();
  globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 202, headers: { 'content-type': 'application/json' } }); };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.magicStart('a@example.test', { purpose: 'signup' });
    await api.magicStart('b@example.test');
    await api.magicStart('c@example.test', { purpose: 'signin' });
  } finally { globalThis.fetch = prev; }
  assert.deepEqual(bodies, [{ email: 'a@example.test', purpose: 'signup' }, { email: 'b@example.test' }, { email: 'c@example.test' }]);
});

test('the sign-in card and the site nav say "create an account", not "apply"', async () => {
  const { default: AuthShell } = await import('../src/components/auth/AuthShell.jsx');
  const card = text(renderToStaticMarkup(h(MemoryRouter, null, h(AuthShell, { showApplyCard: true }, h('div')))));
  assert.match(card, /New to Axal VC\?/);
  assert.match(card, /Free\. Your membership is reviewed after you sign up\./);
  assert.match(card, /Create an account →/);
  assert.doesNotMatch(card, /Apply to Axal VC/);
  assert.match(src('pages/LoginPage.jsx'), /applyLabel="Create an account →"/);
  const { default: PublicNav } = await import('../src/components/PublicNav.jsx');
  const nav = text(renderToStaticMarkup(h(MemoryRouter, null, h(PublicNav))));
  assert.match(nav, /Create account →/);
  assert.doesNotMatch(nav, /\bApply →/);
});

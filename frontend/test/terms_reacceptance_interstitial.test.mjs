/**
 * The screen that asks an existing account for the agreement nobody recorded,
 * and the gate that decides who sees it.
 *
 * WHAT #178 IS FOR. PR #549 made the terms consent real — but at the onboarding
 * licence gate, which only fresh Auth-v2 signups pass through. Every account
 * older than it, plus admins, impersonated sessions, `limited` accounts and the
 * legacy `flow='chat'` rows, still has `tos_v1` and `privacy_v1` sitting
 * `pending`. The product had been showing those people "By continuing you
 * agree" in 10px under a submit button, which is a notice and not an act.
 *
 * The render assertions below pin what the screen does today. The source
 * assertions pin the two things that would break it silently: a gate in the
 * wrong slot, and a flag read loosely enough that `undefined` gates somebody.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/terms_reacceptance_interstitial.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AcceptTermsPage from '../src/pages/AcceptTermsPage.jsx';
import { TERMS_ACCEPTED_EVENT } from '../src/lib/onboarding.js';
import { codeOnlyJsx } from './_codeOnly.mjs';

const src = (p) => codeOnlyJsx(readFileSync(resolve(process.cwd(), p), 'utf8'));
const APP = src('frontend/src/App.jsx');

const render = (props = {}) => renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    null,
    React.createElement(AcceptTermsPage, { email: 'member@example.com', onDecline() {}, ...props }),
  ),
);

test('the checkbox starts unticked and the button will not submit without it', () => {
  // THE WHOLE RECORD RESTS ON THIS. A pre-ticked box would make the checkbox
  // decoration and the acceptance a fiction — which is the state the product
  // previously shipped in, with the claim that continuing constituted agreement
  // living in a code comment. `ChooseLicencePage` records the same reasoning at
  // its own `useState(false)`.
  const html = render();
  const box = html.match(/<input[^>]*data-testid="checkbox-accept-terms"[^>]*>/);
  assert.ok(box, 'the consent checkbox is gone');
  assert.doesNotMatch(box[0], /\bchecked\b/, 'the consent checkbox renders pre-ticked');

  const button = html.match(/<button[^>]*data-testid="button-accept-terms"[^>]*>/);
  assert.ok(button, 'the accept button is gone');
  assert.match(button[0], /\bdisabled\b/,
    'the button is live before anything has been agreed to');
});

test('the documents are linked from the sentence being agreed to', () => {
  // Not just from the footer. The footer's links are for a reader who has not
  // scrolled; the ones inside the label are the ones the sentence points at, and
  // `/terms` and `/privacy` are public routes outside RequireAuth precisely so
  // they work from behind a gate like this one.
  const html = render();
  const label = html.slice(
    html.indexOf('data-testid="checkbox-accept-terms"'),
    html.indexOf('data-testid="button-accept-terms"'),
  );
  assert.match(label, /href="\/terms"/, 'the Terms link is not in the consent sentence');
  assert.match(label, /href="\/privacy"/, 'the Privacy link is not in the consent sentence');
});

test('there is a way out, and it says what it costs', () => {
  // A CONSENT SCREEN WITH NO EXIT IS NOT CONSENT. Clickwrap was chosen over
  // implied acceptance because it is the stronger record, and a record collected
  // from someone with nowhere else to go is weaker than the notice it replaced.
  const html = render();
  assert.match(html, /data-testid="button-decline-terms"/, 'the screen has no exit');
  assert.match(html, /sign(ing)? (me )?out/i);
  assert.match(html, /changes nothing about your account/i,
    'the exit must say what it does, or it reads as "delete my account"');
});

test('the screen makes no claim about a document version', () => {
  // Migration 245 deliberately stores no document hash: `/terms` and `/privacy`
  // are JSX and the `tos_v1`/`privacy_v1` templates are different documents, so
  // nothing in the system knows WHICH bytes a reader saw. A screen that said
  // "version 3" would be inventing the one fact the schema refused to guess.
  const html = render();
  assert.doesNotMatch(html, /\bv(ersion)?\s*\d/i,
    'the copy claims a version the acceptance record cannot support');
});

test('the gate sits between the licence gate and the wizard gate', () => {
  // ORDER IS THE WHOLE DESIGN. After the licence gate, so a fresh signup
  // collects consent once, at the licence screen. Before the wizard gate, so an
  // existing account cannot walk into a wizard ahead of the question.
  const licence = APP.indexOf('<Navigate to="/onboarding" replace />');
  const terms = APP.indexOf('<AcceptTermsPage');
  const wizard = APP.indexOf('const WIZARD_FOR_LICENCE');
  assert.ok(licence > 0 && terms > 0 && wizard > 0, 'one of the three gates has moved or gone');
  assert.ok(licence < terms, 'the terms gate runs before the licence gate — a fresh signup would '
    + 'be asked twice, once here and again at the licence checkbox');
  assert.ok(terms < wizard, 'the terms gate runs after the wizard gate — an account could reach a '
    + 'wizard without ever being asked');
});

test('the gate never stops an admin, an impersonated session or a limited account', () => {
  // The same four exclusions the licence gate above it carries, for the same
  // reasons: support staff must be able to reach an account, an impersonator is
  // not the person who would be consenting, and a `limited` account is mid
  // remediation. An admin's obligations really are pending and /me says so —
  // this is where that fact stops being a reason to interrupt anybody.
  const at = APP.indexOf('<AcceptTermsPage');
  const gate = APP.slice(APP.lastIndexOf('if (', at), at);
  for (const clause of [
    'termsPending',
    "chatGateRole !== 'admin'",
    "realUser?.role !== 'admin'",
    '!isImpersonating',
    "accessLevel !== 'limited'",
    '!licenceGateOwnsConsent',
  ]) {
    assert.ok(gate.includes(clause), `the terms gate no longer checks \`${clause}\``);
  }
});

test('a missing flag does not gate, in three different ways', () => {
  // THE FAILURE THIS PREVENTS IS TOTAL AND SILENT. The dev FastAPI's /me returns
  // a different shape with no such key; an older worker returns none either; and
  // for one render before /me answers there is no value at all. If any of those
  // read as "gate", a Replit session — or every session, for one frame — is shut
  // out of the product behind a screen whose accept call is also failing.
  assert.match(APP, /const \[termsPending, setTermsPending\] = useState\(false\)/,
    'the initial value is not `false`, so the interstitial can flash before /me answers');
  assert.match(APP, /setTermsPending\(me\.terms_acceptance_pending === true\)/,
    'the flag is read loosely; `undefined` must land on "do not gate" and only an '
    + 'explicit `true` may gate');
});

test('accepting retires the shell\'s belief without a reload', () => {
  // `RequireAuth` reads the flag in an effect keyed on `[user?.id]` — once per
  // session, never again — so nothing about accepting would reach it. The page
  // announces instead, which is the mechanism `ONBOARDING_COMPLETE_EVENT`
  // already established one gate along, for the identical reason.
  assert.equal(TERMS_ACCEPTED_EVENT, 'axal:terms-accepted');
  const page = src('frontend/src/pages/AcceptTermsPage.jsx');
  assert.match(page, /dispatchEvent\(new CustomEvent\(TERMS_ACCEPTED_EVENT\)\)/,
    'the page does not announce its own success — the interstitial would re-render '
    + 'itself over the page the reader was heading for');
  assert.match(APP, /window\.addEventListener\(TERMS_ACCEPTED_EVENT/,
    'the shell does not listen, so the announcement reaches nobody');
});

test('the accept call carries no identity of its own', () => {
  // The one thing that must never be possible is recording an acceptance for
  // somebody else. Migration 245's rationale names `admin backfill` as a
  // distinguishable surface; that it is distinguishable is not permission to
  // write it. The client half of the refusal is that there is nothing to send.
  const api = src('frontend/src/lib/api.js');
  const line = api.split('\n').find((l) => l.includes('acceptTerms:'));
  assert.ok(line, 'api.acceptTerms is gone');
  assert.match(line, /request\('\/auth\/accept-terms', \{ method: 'POST' \}\)/);
  assert.doesNotMatch(line, /body|userId|user_id/,
    'the call sends a body; an acceptance must be attributable to the session and '
    + 'to nothing the caller can choose');
});

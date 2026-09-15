/**
 * The consent on the licence gate has to be an act, not a notice.
 *
 * This screen shipped for months with the two agreements as footer links and a
 * comment claiming a member "accepts by continuing". Nothing recorded an
 * acceptance, so `tos_v1` and `privacy_v1` sat `pending` on every account for the
 * life of the account (`cloudflare-worker/test/obligation_satisfiable.test.ts`),
 * and the strongest thing that could be said about consent was that a 10px line of
 * text existed on a different page.
 *
 * The fix only works if three properties hold together, and each is cheap to break
 * by accident:
 *
 *   1. the checkbox exists and starts UNTICKED — a pre-ticked box is not an act;
 *   2. the CTA is disabled until it is ticked — otherwise the box is decoration;
 *   3. the real state is sent to the server — passing `true` unconditionally would
 *      make the record a fiction while every test above still passed.
 *
 * Read as text rather than rendered: this repo's frontend suite has no DOM, and
 * these are structural facts about the source, not behaviours of a component tree.
 * The server-side half is tested for real in
 * `cloudflare-worker/test/terms_acceptance.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = read('frontend/src/pages/ChooseLicencePage.jsx');
const api = read('frontend/src/lib/api.js');
const route = read('cloudflare-worker/src/routes/onboarding.ts');

test('the checkbox exists and starts unticked', () => {
  assert.match(page, /type="checkbox"/, 'the licence gate has no checkbox at all');
  // ANCHORED ON THE DECLARATION, NOT ON `useState(false)` ANYWHERE. A bare
  // /useState\(false\)/ passed this file while the consent state was initialised
  // to `true`, because the page also declares `const [busy, setBusy] =
  // useState(false)`. That escape is the whole property this test exists for: a
  // pre-ticked box makes every acceptance record a fiction, and it survived a
  // mutation. The variable name has to be in the pattern.
  assert.match(page, /const \[accepted, setAccepted\] = useState\(false\)/,
    'the consent state does not start false — a pre-ticked box is not an act, and '
    + 'the acceptance it records is not one the person performed');
  assert.match(page, /checked=\{accepted\}/, 'the checkbox is not bound to the consent state');
  assert.match(page, /setAccepted\(e\.target\.checked\)/,
    'the checkbox does not write the consent state, so ticking it changes nothing');
});

test('the checkbox names both documents and links them', () => {
  // A consent control that does not say what is being agreed to is not consent.
  const label = page.slice(page.indexOf('type="checkbox"') - 600, page.indexOf('type="checkbox"') + 900);
  assert.match(label, /agree to the/i, 'the consent label does not say the person agrees to anything');
  assert.match(label, /to="\/terms"/, 'the consent label does not link the Terms of Service');
  assert.match(label, /to="\/privacy"/, 'the consent label does not link the Privacy Policy');
});

test('the CTA cannot be used until consent is given', () => {
  assert.match(page, /disabled=\{busy \|\| !selected \|\| !accepted\}/,
    'the Continue button is not gated on consent, so the checkbox is decoration');
  assert.match(page, /if \(!selected \|\| !accepted\) return;/,
    'submit() does not re-check consent; a disabled attribute alone is a UI hint, '
    + 'not a guard');
});

test('the real consent state is sent, not a hardcoded true', () => {
  assert.match(page, /api\.onboardingChooseLicence\(selected, accepted\)/,
    'the page does not pass its consent state to the API call');
  const method = api.slice(api.indexOf('onboardingChooseLicence:'), api.indexOf('onboardingChooseLicence:') + 420);
  assert.match(method, /accepted_terms: acceptedTerms === true/,
    'the api method does not forward the caller\'s consent verbatim — a literal '
    + '`true` here would record an acceptance nobody gave');
  assert.doesNotMatch(method, /accepted_terms: true\b/,
    'accepted_terms is hardcoded true in the api layer, which makes every record a fiction');
});

test('the server refuses the request without consent', () => {
  // The client gate is a courtesy; this is the one that holds. Without it a
  // crafted POST takes the licence and skips the record, which is the exact state
  // this whole change exists to end.
  assert.match(route, /body\.accepted_terms !== true/,
    'the licence route does not require the consent flag');
  assert.match(route, /terms_acceptance_required/,
    'the refusal has no named error, so a client cannot tell it apart from a validation failure');
  assert.match(route, /recordTermsAcceptance\(/,
    'the route accepts the flag but never records it, which is worse than not asking');
});

test('the stale "accepts by continuing" claim is gone', () => {
  // The comment that made this defect survive review: it asserted the acceptance
  // the code never performed, and it read as a description of working behaviour.
  assert.doesNotMatch(page, /agreements a member accepts by continuing/,
    'the comment still claims acceptance happens by continuing; it happens at the checkbox');
});

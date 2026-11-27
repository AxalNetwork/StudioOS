/**
 * D691 — the deck share signup modal draws Turnstile and sends its token
 * (issue #1705).
 *
 * The Worker now refuses `POST /api/decks/share/:token/signup` without a
 * solved Turnstile challenge (cloudflare-worker/test/deck_share_signup_guards_d691.test.ts),
 * so the modal must render the widget, send `turnstileToken` with the form,
 * and, when the widget cannot load, say so instead of leaving Continue dead.
 *
 * PINNED IN SOURCE, NOT RENDERED. The modal reads its site key from
 * `import.meta.env` at module load, as RegisterPage does, and that has no
 * value under `node --test`, so a render would only ever see the no-key branch.
 * Each assertion reads one property from the component's code (comments
 * stripped), the way the other import.meta.env surfaces are pinned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MODAL = codeOnly(read('frontend/src/components/ShareViewerSignupModal.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `could not slice ${from} → ${to}`);
  return src.slice(a, b);
}

test('the modal loads Turnstile with the shared loader and the register site key', () => {
  assert.match(MODAL, /import \{ loadTurnstile \} from '\.\.\/lib\/turnstile'/);
  assert.match(MODAL, /import\.meta\.env && import\.meta\.env\.VITE_TURNSTILE_SITE_KEY/);
  assert.match(MODAL, /loadTurnstile\(\)/);
  assert.match(MODAL, /window\.turnstile\.render\(turnstileRef\.current,\s*\{\s*sitekey: TURNSTILE_SITE_KEY/);
  assert.match(MODAL, /ref=\{turnstileRef\}/, 'no element for the widget to render into');
});

test('the signup sends turnstileToken, and the client passes the payload through', () => {
  const submit = slice(MODAL, 'async function submitSignup', 'async function submitNda');
  assert.match(submit, /api\.deckShareSignup\(shareToken,\s*\{[^}]*\bturnstileToken\b[^}]*\}/,
    'the token is not in the signup body');
  // No new /api method: the existing one forwards whatever it is given.
  assert.match(API, /deckShareSignup: \(token, payload\) => request\([\s\S]{0,120}body: JSON\.stringify\(payload \|\| \{\}\)/);
});

test('Continue waits for a token, and a refused submit gets a fresh challenge', () => {
  assert.match(MODAL, /type="submit" disabled=\{busy \|\| \(TURNSTILE_SITE_KEY && !turnstileToken\)\}/);
  const submit = slice(MODAL, 'async function submitSignup', 'async function submitNda');
  assert.match(submit, /if \(TURNSTILE_SITE_KEY && !turnstileToken\)[\s\S]{0,60}setError\(/,
    'a submit without a token reaches the Worker');
  assert.match(submit, /resetTurnstileWidget\(\)/, 'a single-use token is reused after a refusal');
});

test('when Turnstile cannot load the modal says so, after a bounded poll', () => {
  // The poll gives up (50 attempts) and flips the flag, rather than spinning forever.
  assert.match(MODAL, /attempts >= 50\)\s*\{\s*clearInterval\(interval\);\s*setTurnstileFailed\(true\)/);
  // And the flag draws register's fail-visible line.
  const shown = slice(MODAL, '{TURNSTILE_SITE_KEY && turnstileFailed && (', 'type="submit"');
  assert.match(shown, /Human verification couldn't load — usually an ad blocker or strict network\./);
  // With dark classes, so the notice is legible in dark mode.
  assert.match(shown, /dark:text-amber-200/);
  assert.match(shown, /dark:bg-amber-900\/20/);
});

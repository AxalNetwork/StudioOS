/**
 * #4577 — the sign-in and registration labels are associated with their inputs.
 *
 * A visible "Email" beside an input with no id gives the input no accessible name, and a click on the word focuses
 * nothing. Each label now names its input with a matching `htmlFor`/`id`; an error shown above the form is described
 * to its inputs, and the input a message is about says `aria-invalid`.
 *
 * The pages read `import.meta.env` when they load, so they cannot be imported under Node; like their sibling guards
 * this file reads the JSX (comments stripped) and pairs each label with the input it names.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/auth_labels_4577.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const page = (name) => codeOnly(readFileSync(path.resolve(import.meta.dirname, `../src/pages/${name}`), 'utf8'));
const LOGIN = page('LoginPage.jsx');
const REGISTER = page('RegisterPage.jsx');

/** Every `<label … htmlFor="X" …>Text</label>`: { id, text }. */
const labels = (src) => [...src.matchAll(/<label\b([^>]*)>\s*([^<{]+?)\s*<\/label>/g)]
  .map((m) => ({ attrs: m[1], text: m[2], id: /\bhtmlFor="([^"]+)"/.exec(m[1])?.[1] || null }));
/** The `<input …>` element carrying `id="X"`, as written. */
const inputOf = (src, id) => {
  const at = src.search(new RegExp(`<input\\b[^>]*?\\bid="${id}"`, 's'));
  if (at < 0) return null;
  return src.slice(at, src.indexOf('/>', at) + 2);
};

test('sign-in: Email and Authenticator code are visible labels with a matching input id', () => {
  const found = labels(LOGIN);
  assert.deepEqual(found.map((l) => l.text), ['Email', 'Authenticator code']);
  assert.deepEqual(found.map((l) => l.id), ['login-email', 'login-totp']);
  const email = inputOf(LOGIN, 'login-email');
  assert.ok(email, 'an input carries login-email');
  assert.match(email, /type="email"/);
  assert.match(email, /autoComplete="email"/, 'autocomplete is kept');
  assert.match(email, /inputMode="email"/);
  const totp = inputOf(LOGIN, 'login-totp');
  assert.ok(totp, 'an input carries login-totp');
  assert.match(totp, /autoComplete="one-time-code"/);
});

test('sign-in: no label is left without an input to name', () => {
  for (const l of labels(LOGIN)) assert.ok(l.id, `the "${l.text}" label has htmlFor`);
});

test('registration: Full Name and Email are associated and keep their types and autocomplete', () => {
  const found = labels(REGISTER);
  assert.deepEqual(found.map((l) => [l.text, l.id]), [['Full Name', 'register-name'], ['Email', 'register-email']]);
  const name = inputOf(REGISTER, 'register-name');
  const email = inputOf(REGISTER, 'register-email');
  assert.ok(name && email);
  assert.match(name, /type="text"/);
  assert.match(name, /autoComplete="name"/);
  assert.match(email, /type="email"/);
  assert.match(email, /autoComplete="email"/);
  assert.match(email, /inputMode="email"/);
});

test('an error above the form is described to the inputs; the field it is about is aria-invalid', () => {
  assert.match(LOGIN, /id="login-error"\s+role="alert"/, 'the sign-in error is an alert with an id');
  assert.match(REGISTER, /id="register-error"\s+role="alert"/);
  for (const [src, id, error] of [[LOGIN, 'login-email', 'login-error'], [LOGIN, 'login-totp', 'login-error'], [REGISTER, 'register-name', 'register-error'], [REGISTER, 'register-email', 'register-error']]) {
    const input = inputOf(src, id);
    assert.match(input, new RegExp(`aria-describedby=\\{error \\? '${error}' : undefined\\}`), `${id} is described by ${error}`);
    assert.match(input, /aria-invalid=\{error && errorField === '/, `${id} says when it is the invalid one`);
  }
  // The field a message is about is set where the message is: an empty email, a bad email, a missing name.
  assert.match(LOGIN, /setErrorField\('email'\);\s*setError\('Enter your email\.'\)/);
  assert.match(LOGIN, /setErrorField\('totp'\);\s*setError\('Enter the 6-digit code/);
  assert.match(REGISTER, /setErrorField\('name'\);\s*setError\('Please enter your full name'\)/);
  assert.match(REGISTER, /setErrorField\('email'\);\s*setError\('Please enter a valid email address/);
  // ...and cleared with the message, so a later unrelated error never marks a field invalid.
  assert.match(LOGIN, /if \(!error\) setErrorField\(null\)/);
  assert.match(REGISTER, /if \(!error\) setErrorField\(null\)/);
});

test('no two inputs on a page share an id', () => {
  for (const src of [LOGIN, REGISTER]) {
    const ids = [...src.matchAll(/<input\b[^>]*?\bid="([^"]+)"/gs)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, ids.join(', '));
  }
});

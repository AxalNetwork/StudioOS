/**
 * E-sign de-admin (task #119) — the guarantees that replaced the admin gate.
 *
 * POST /send, GET / and GET /:id were requireAdmin. They are now requireAuth,
 * which means the ONLY things standing between a signed-in user and another
 * tenant's contracts are the scope clause and the rate limit. These tests read
 * the route source directly, because the failure they guard against is a
 * refactor quietly dropping a clause — which produces working software that
 * serves the wrong rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Comments stripped before any assertion runs.
 *
 * Not optional hygiene: the first version of the 404-not-403 test below failed
 * against its own explanatory comment, which contains the string "403". Three
 * separate assertions in this repo have now passed or failed on prose rather
 * than code, so the scanner is the default here as it is in the frontend tests.
 * It has to be a scanner rather than a regex — a regex stripper reads the `/*`
 * inside a route pattern as a block-comment opener and eats the rest of a file.
 */
function stripComments(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const c = input[i], d = input[i + 1];
    if (c === '/' && d === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < input.length; ) {
        if (input[i] === '\\') { out += input.slice(i, i + 2); i += 2; continue; }
        out += input[i];
        const end = input[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const raw = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/esign.ts'), 'utf8');
const src = stripComments(raw);

/** The body of one route handler, from its registration to the next one. */
function handler(sig: string): string {
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, `route ${sig} must exist`);
  const rest = src.slice(start + sig.length);
  const next = rest.search(/\nesign\.(get|post|put|patch|delete)\(/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

// ---------- the gate is really off ----------

test('the three de-admined routes no longer call requireAdmin', () => {
  for (const sig of ["esign.post('/send'", "esign.get('/'", "esign.get('/:id{[0-9]+}'"]) {
    assert.doesNotMatch(handler(sig), /requireAdmin\s*\(/, `${sig} must not re-gate on admin`);
    assert.match(handler(sig), /requireAuth\s*\(/, `${sig} must still require a signed-in user`);
  }
});

test('requireAdmin is not imported at all, so it cannot creep back silently', () => {
  // If a future route genuinely needs it, re-adding the import is a visible
  // decision in review rather than a one-word change to an existing line.
  assert.doesNotMatch(src, /import\s*\{[^}]*requireAdmin/);
});

// ---------- reads are scoped ----------

test('both read routes compose the shared scope, not a local WHERE', () => {
  // The brief forbids ad-hoc tenancy filters in route files. Route code may
  // COMPOSE the clause; it may not decide the policy.
  for (const sig of ["esign.get('/'", "esign.get('/:id{[0-9]+}'"]) {
    assert.match(handler(sig), /esignEnvelopeScope\(/, `${sig} must use the shared scope`);
  }
  assert.match(src, /from '\.\.\/services\/tenancyScope'/);
});

test('the list scopes even with no query filter', () => {
  // The original built its WHERE only when a filter was present, so an
  // unfiltered list returned every row. Harmless under requireAdmin; a
  // cross-tenant leak the moment the gate came off.
  const h = handler("esign.get('/'");
  assert.match(h, /const where: string\[\] = \[scope\.sql\]/, 'scope seeds the WHERE unconditionally');
  assert.match(h, /WHERE \$\{where\.join\(' AND '\)\}/, 'the WHERE is always emitted');
  // The old conditional-WHERE construction must be gone entirely.
  assert.doesNotMatch(h, /where\.length \? 'LEFT JOIN/);
});

test('the detail route binds the scope alongside the id', () => {
  const h = handler("esign.get('/:id{[0-9]+}'");
  assert.match(h, /WHERE e\.id = \? AND \$\{scope\.sql\}/);
  assert.match(h, /\.bind\(id, \.\.\.scope\.binds\)/, 'scope binds must follow the id bind');
});

test('an out-of-scope envelope is a 404, never a 403', () => {
  // A 403 confirms the row exists. On a sequential integer id that is an
  // enumeration oracle for how many contracts the platform has issued.
  const h = handler("esign.get('/:id{[0-9]+}'");
  assert.match(h, /'Envelope not found'.*404/s);
  assert.doesNotMatch(h, /403/);
});

// ---------- origination ----------

test('origination is rate-limited by a fail-closed bucket', () => {
  const rl = stripComments(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/middleware/rateLimit.ts'), 'utf8'));
  const bucket = rl.slice(rl.indexOf("name: 'esign_send'"), rl.indexOf("name: 'esign_send'") + 400);
  assert.match(bucket, /failClosed:\s*true/);
  assert.match(bucket, /'\/api\/legal\/esign\/send'/);
});

test('the sender identity on the outbound mail is the sender, not a fixed admin', () => {
  // A recipient must be able to see who actually asked them to sign.
  const h = handler("esign.post('/send'");
  assert.match(h, /adminUserId: sender\.id/);
  assert.match(h, /adminName: sender\.name \|\| sender\.email/);
  assert.doesNotMatch(h, /\badmin\.(id|name|email)\b/, 'no admin-shaped identity may remain');
});

test('the docusign tier gate follows the sender', () => {
  // Studio-only provider. Gating on a stale `admin` binding would have thrown
  // a ReferenceError on the first non-native send rather than returning 402.
  assert.match(handler("esign.post('/send'"), /userMeetsTier\(sender, 'studio'\)/);
});

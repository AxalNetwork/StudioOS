/**
 * Task #144 — the licence picker moved to `/onboarding` and became
 * "Choose your adventure".
 *
 * These are source assertions rather than rendered ones because the thing
 * worth pinning is structural: which path mounts the page, which paths the
 * two onboarding gates in App.jsx treat as "already there", and which exact
 * sentences the page does and does not carry. A render would prove the copy
 * and miss the gates entirely — and the gates are where this change could
 * break onboarding for every new account without changing a pixel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeBlock } from './_routes.mjs';
import { OWNERSHIP_NOTICE, LEGAL_LINKS } from '../src/lib/legalNotice.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const page = read('../src/pages/ChooseLicencePage.jsx');
const shell = read('../src/components/auth/AuthShell.jsx');
const publicFooter = read('../src/components/PublicFooter.jsx');

/**
 * Strip JSX comments and JS line comments so a banned phrase quoted in an
 * explanation cannot satisfy — or fail — an assertion about what the page
 * RENDERS. This trap has bitten this repo repeatedly: a comment saying "we
 * no longer say X" contains X.
 */
function codeOnly(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * `codeOnly` with the import block dropped too.
 *
 * Asserting that a symbol merely APPEARS in the file is satisfied by the
 * line that imports it, so "the page renders LEGAL_LINKS" stayed green with
 * the whole footer deleted — the import alone matched. Both escapes in this
 * file's first mutation run were that, so anything checking what the page
 * RENDERS reads this, never `codeOnly`.
 */
function bodyOnly(src) {
  return codeOnly(src).replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
}

/** Curly and straight apostrophes read identically; normalise before compare. */
const flat = (s) => s.replace(/[‘’]/g, "'").replace(/&rsquo;/g, "'");

// ---------- 1. the route moved, and the old one still resolves ----------

test('/onboarding mounts the licence picker', () => {
  const block = routeBlock(app, '/onboarding');
  assert.ok(block, 'no <Route path="/onboarding"> is declared');
  assert.match(block, /<ChooseLicencePage \/>/, '/onboarding must mount ChooseLicencePage');
});

test('/onboarding/licence redirects rather than mounting a second copy', () => {
  const block = routeBlock(app, '/onboarding/licence');
  assert.ok(block, 'the old path must stay mounted as a redirect, not be deleted');
  assert.match(
    block,
    /<Navigate to="\/onboarding" replace \/>/,
    'a welcome email or bookmark on the old path must land on /onboarding, not 404',
  );
  assert.doesNotMatch(
    block,
    /ChooseLicencePage/,
    'two live mounts of the picker let the gate and the links disagree on which is canonical',
  );
});

// ---------- 2. BOTH gates follow the page ----------
//
// The licence gate sends a fresh account to the picker; the wizard-resume
// gate sends a part-way account back to its role wizard. The second one
// tests `startsWith('/onboarding/')`, which was true of the OLD path for
// free and is false of the bare one — so if it is not widened, the wizard
// gate bounces the user straight off the page the licence gate just sent
// them to, and a new account can never choose anything.

test('the licence gate sends users to /onboarding and recognises them once there', () => {
  assert.match(
    app,
    /const onLicencePath = location\.pathname === '\/onboarding';/,
    'the gate must consider the NEW path "already there", or it redirects in a loop',
  );
  // Read only this gate's own body — from its flow test to its closing
  // `}` — so a <Navigate> belonging to the chat gate above or the wizard
  // gate below cannot stand in for this one's.
  const start = app.indexOf("onboardingFlow === 'licence'");
  assert.ok(start > 0, 'the licence gate has gone');
  const body = app.slice(start, app.indexOf('\n  }', start));
  assert.match(
    body,
    /<Navigate to="\/onboarding" replace \/>/,
    'the gate must send users to the new path',
  );
});

test('the wizard-resume gate counts the bare /onboarding as an onboarding path', () => {
  const decl = app.slice(app.indexOf('const onWizardPath'), app.indexOf('const needsWizard'));
  assert.match(
    decl,
    /location\.pathname === '\/onboarding'/,
    "'/onboarding'.startsWith('/onboarding/') is FALSE — without the exact match this gate "
      + 'bounces every new account off the licence picker',
  );
  assert.match(decl, /startsWith\('\/onboarding\/'\)/, 'the role wizards must stay covered too');
});

// ---------- 3. the copy the user specified ----------

test('the heading is "Choose your adventure"', () => {
  const body = codeOnly(page);
  assert.match(body, /Choose your adventure/, 'the new heading is missing');
  assert.doesNotMatch(body, /Choose your licence/, 'the old heading must be gone');
});

test('the subtext is exactly the sentence the user supplied', () => {
  const body = flat(codeOnly(page));
  assert.match(
    body,
    /Pick your path and we'll open the right workspace and send the matching agreement\./,
    'first sentence of the subtext does not match',
  );
  assert.match(
    body,
    /You can start working while your membership is reviewed\./,
    'second sentence of the subtext does not match',
  );
  assert.doesNotMatch(
    body,
    /This decides which workspace opens and which agreement we send/,
    'the old subtext must be gone',
  );
});

test('the invite-only paragraph is gone', () => {
  const body = codeOnly(page);
  assert.doesNotMatch(body, /Admin access is invite-only/, 'the user asked for this paragraph removed');
  assert.doesNotMatch(body, /Territory operators receive their licence by email/, 'second half of it survives');
});

// ---------- 4. the background, and the width that makes it a desktop page ----------

test('the page carries the purple landscape background', () => {
  assert.match(
    codeOnly(page),
    /backgroundSrc="\/auth\/login-background\.webp"/,
    'the licence picker must use the same background image as /login and /register',
  );
});

test('AuthShell can widen, and the licence picker opts in', () => {
  const shellTag = bodyOnly(page).match(/<AuthShell[\s\S]*?>/);
  assert.ok(shellTag, 'the page must render an <AuthShell>');
  assert.match(shellTag[0], /^\s*<AuthShell[\s\S]*\bwide\b/, 'the page must ask for the wide measure');
  assert.match(
    shell,
    /wide \? 'max-w-\[840px\]' : 'max-w-\[404px\]'/,
    'AuthShell must offer a wider measure while leaving the default alone',
  );
});

test('widening is opt-in, so /login and /register keep their 404px column', () => {
  const login = read('../src/pages/LoginPage.jsx');
  const register = read('../src/pages/RegisterPage.jsx');
  assert.match(shell, /wide = false,/, 'the wide measure must default off');
  for (const [name, src] of [['LoginPage', login], ['RegisterPage', register]]) {
    const shellTag = src.slice(src.indexOf('<AuthShell'), src.indexOf('<AuthShell') + 220);
    assert.doesNotMatch(shellTag, /\bwide\b/, `${name} is a single-column form and must not widen`);
  }
});

test('the licence cards stack on a phone and pair up above it', () => {
  const body = codeOnly(page);
  assert.match(body, /grid-cols-1/, 'cards must be one column at phone width');
  assert.match(body, /sm:grid-cols-2/, 'cards must use the width once there is width to use');
});

// ---------- 5. the legal footer ----------

test('the page links Terms of Service and Privacy Policy', () => {
  const body = bodyOnly(page);
  assert.match(
    body,
    /\{LEGAL_LINKS\.map\(/,
    'the footer must MAP the shared list — importing it and rendering nothing is not linking it',
  );
  assert.match(body, /<Link\b[\s\S]{0,200}?\{l\.label\}/, 'each entry must render as a real <Link>');
  assert.deepEqual(
    LEGAL_LINKS.map((l) => l.label),
    ['Terms of Service', 'Privacy Policy'],
    'the user asked for these two, with these names',
  );
  for (const l of LEGAL_LINKS) {
    assert.ok(
      routeBlock(app, l.to),
      `${l.to} is linked from onboarding but no route mounts it — the link would 404`,
    );
  }
});

test('the ownership notice names the operator and the IP owner', () => {
  assert.match(
    bodyOnly(page),
    /\{OWNERSHIP_NOTICE\}/,
    'the page must INTERPOLATE the notice; importing it and rendering nothing is not showing it',
  );
  assert.match(OWNERSHIP_NOTICE, /Axal VC Management LLC/, 'the operating entity must be named');
  assert.match(OWNERSHIP_NOTICE, /Axal VC Holdings LLC/, 'the IP-owning entity must be named');
  assert.match(OWNERSHIP_NOTICE, /All rights reserved\./);
});

test('the public footer and the onboarding footer read from one constant', () => {
  assert.match(
    publicFooter,
    /\{OWNERSHIP_NOTICE\}/,
    'PublicFooter must render the shared constant, not a second copy that can drift',
  );
  assert.doesNotMatch(
    publicFooter,
    /Platform operated by Axal VC Management LLC/,
    'a literal copy of the notice has reappeared in PublicFooter',
  );
});
